-- ============================================================================
-- 050_document_spine.sql   §3.3 / D6 / D17.  The document spine.
--
-- Legal transitions, and there are no others:
--   draft --submit--> submitted --cancel--> cancelled --amend--> (new draft)
--   draft --delete--> gone   (audit records the deletion with a full snapshot)
-- `submitted -> draft` DOES NOT EXIST.
--
-- Immutability is enforced by a DATABASE TRIGGER, not a service convention.
-- On docstatus = 1 every column is immutable except a per-entity allow_on_submit
-- allowlist, which for statutory documents contains ONLY framework-written
-- derived status fields, written exclusively by derivation services.
--
-- D17: document_date (the date the document BEARS) is separate from
-- posting_date (the date it hits the ledger), and gst_report_period (the return
-- period it is REPORTED in) is a third, stored, stamped-at-post-time field.
-- The GSTR builders read gst_report_period, never posting_date; ageing,
-- interest and statutory windows read document_date or supply_date; the four
-- period gates test posting_date.  Retrofitting this is a ledger backfill plus
-- a re-run of every filed return.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- The registry the immutability trigger reads.  One row per submittable
-- document type (~27 of them, §3.2).  allow_on_submit is DATA so that adding a
-- derived field is a migration row, not a new trigger.
-- ---------------------------------------------------------------------------
create table erp.document_type (
  doc_type          text primary key,
  table_schema      text not null default 'public',
  table_name        text not null,
  is_statutory      boolean not null,
  requires_series   boolean not null,
  default_series_nature erp.series_nature,
  allow_on_submit   text[] not null default '{}',
  -- §3.3: amend_seq > 3 requires a supervisor role.
  amend_seq_supervisor_threshold smallint not null default 3,
  -- §3.4: the ONE named period-gate exemption is keyed to a VOUCHER TYPE, not
  -- to a role.  deemed_supply_143 may pass gates (b) and (d) with a mandatory
  -- reason.  Everything else is refused.  If a voucher class legitimately
  -- breaks an invariant it is MODELLED AS A TYPE, never exempted by matching a
  -- name string.
  may_bypass_frozen_accounts boolean not null default false,
  may_bypass_filed_return    boolean not null default false,
  constraint document_type_table_uq unique (table_schema, table_name),
  constraint document_type_series_nature
    check (not requires_series or default_series_nature is not null)
);

-- The default allowlist for a statutory document.  Framework-written derived
-- status fields only - never a user field, never an ad-hoc db_set.
create or replace function erp.default_allow_on_submit() returns text[]
  language sql immutable as
$fn$ select array['status','irn_status','ewb_status','per_billed','per_received',
                  'outstanding_amount','updated_at','updated_by']::text[] $fn$;

-- ---------------------------------------------------------------------------
-- The immutability + lifecycle trigger.  ONE function for every document table.
-- ---------------------------------------------------------------------------
create or replace function erp.tg_document_spine() returns trigger
  language plpgsql as
$fn$
declare
  dt        erp.document_type%rowtype;
  allowed   text[];
  changed   text[];
  bad       text[];
  src_status smallint;
begin
  select * into dt from erp.document_type
   where table_schema = tg_table_schema and table_name = tg_table_name;
  if not found then
    raise exception 'table %.% carries the document spine but is not registered in erp.document_type',
      tg_table_schema, tg_table_name using errcode = 'ERP10';
  end if;

  -- ---------------- DELETE ----------------
  if tg_op = 'DELETE' then
    if old.docstatus <> 0 then
      raise exception 'only drafts may be deleted; % is docstatus %', tg_table_name, old.docstatus
        using errcode = 'ERP12',
              hint = 'Submitted documents are cancelled (reversed), never deleted (L2).';
    end if;
    return old;
  end if;

  -- ---------------- INSERT ----------------
  if tg_op = 'INSERT' then
    if new.docstatus <> 0 then
      raise exception 'a document is created as a draft (docstatus 0), not %', new.docstatus
        using errcode = 'ERP11';
    end if;
    if new.doc_no is not null or new.doc_ordinal is not null then
      raise exception 'numbers are assigned at submit, never at draft creation (§3.6)'
        using errcode = 'ERP11';
    end if;
    if new.amended_from is not null then
      execute format('select docstatus from %I.%I where id = $1', tg_table_schema, tg_table_name)
        into src_status using new.amended_from;
      if src_status is distinct from 2 then
        raise exception 'amended_from must reference a cancelled document (docstatus 2), found %',
          src_status using errcode = 'ERP13';
      end if;
      if new.amend_seq < 1 then
        raise exception 'an amendment carries amend_seq >= 1' using errcode = 'ERP13';
      end if;
    elsif new.amend_seq <> 0 then
      raise exception 'amend_seq > 0 requires amended_from' using errcode = 'ERP13';
    end if;
    return new;
  end if;

  -- ---------------- UPDATE ----------------
  -- Transition legality first: 0->0, 0->1, 1->1, 1->2.  Nothing else.
  if not ((old.docstatus = 0 and new.docstatus in (0,1))
       or (old.docstatus = 1 and new.docstatus in (1,2))
       or (old.docstatus = 2 and new.docstatus = 2)) then   -- 2->2 falls through to the freeze check
    raise exception 'illegal docstatus transition % -> % on %',
      old.docstatus, new.docstatus, tg_table_name
      using errcode = 'ERP11',
            hint = 'submitted -> draft does not exist. Cancel, then amend.';
  end if;

  -- A draft is mutable, and 0->1 rewrites the spine (doc_no, series, dates).
  if old.docstatus = 0 then
    return new;
  end if;

  -- docstatus 1 or 2: compute the changed column set generically.
  select coalesce(array_agg(k order by k), '{}') into changed
    from (select jsonb_object_keys(to_jsonb(old)) as k) s
   where to_jsonb(old) -> k is distinct from to_jsonb(new) -> k;

  if old.docstatus = 2 then
    if changed <> '{}' then
      raise exception 'a cancelled document is frozen; changed: %', changed
        using errcode = 'ERP10';
    end if;
    return new;
  end if;

  -- old.docstatus = 1
  allowed := dt.allow_on_submit;
  if new.docstatus = 2 then
    -- The cancellation write itself.
    allowed := allowed || array['docstatus','cancelled_at','cancelled_by','cancel_reason'];
    if nullif(btrim(new.cancel_reason), '') is null then
      raise exception 'cancellation requires a reason (D1)' using errcode = 'ERP61';
    end if;
  end if;

  select coalesce(array_agg(c), '{}') into bad
    from unnest(changed) c where not (c = any (allowed));
  if bad <> '{}' then
    raise exception 'document %.% is submitted and immutable; refused columns: % (allowed: %)',
      tg_table_schema, tg_table_name, bad, allowed
      using errcode = 'ERP10',
            hint = 'Government responses live in side tables; derived fields are written by derivation services only.';
  end if;

  return new;
end
$fn$;

-- ---------------------------------------------------------------------------
-- erp.add_document_spine(schema, table, doc_type, ...)
-- The macro.  Adds the spine columns, the constraints, the indexes, the
-- self-FK for amendment linkage, and the trigger, and registers the type.
-- Drizzle cannot express this, so the migration is hand-written SQL - which is
-- §3.1's stated process ("drizzle-kit generate emits plain .sql we hand-edit").
-- ---------------------------------------------------------------------------
create or replace function erp.add_document_spine(
  p_schema        text,
  p_table         text,
  p_doc_type      text,
  p_is_statutory  boolean default true,
  p_requires_series boolean default true,
  p_series_nature erp.series_nature default null,
  p_allow_on_submit text[] default null
) returns void
  language plpgsql as
$fn$
declare q text;
begin
  execute format($ddl$
    alter table %1$I.%2$I
      add column tenant_id        uuid not null default erp.this_tenant(),
      add column company_id       uuid not null references company(id),
      add column registration_id  uuid not null references gstin_registration(id),
      add column doc_type         text not null default %3$L,
      add column series_id        uuid references document_series(id),
      add column doc_no           text,
      add column doc_ordinal      bigint,
      add column docstatus        erp.docstatus not null default 0,
      add column document_date    date not null,
      add column posting_date     date not null,
      add column gst_report_period erp.gst_period,
      add column amended_from     uuid references %1$I.%2$I(id),
      add column amend_seq        smallint not null default 0,
      add column original_doc_no  text,
      add column original_doc_date date,
      add column amendment_period erp.gst_period,
      add column ruleset_version_id uuid references ruleset_version(id),
      add column is_opening       boolean not null default false,
      add column is_migration     boolean not null default false,
      add column status           text,
      add column irn_status       text,
      add column ewb_status       text,
      add column cancelled_at     timestamptz,
      add column cancelled_by     uuid,
      add column cancel_reason    text,
      add column ext              jsonb not null default %4$L,
      add column created_at       timestamptz not null default now(),
      add column created_by       uuid not null,
      add column updated_at       timestamptz not null default now(),
      add column updated_by       uuid not null
  $ddl$, p_schema, p_table, p_doc_type, '{}');

  -- D17: the document bears its date on or before the day it hits the ledger.
  execute format($ddl$
    alter table %1$I.%2$I
      add constraint %2$s_date_order check (document_date <= posting_date),
      -- §3.6: numbers exist only on submitted/cancelled documents; drafts show
      -- DRAFT-<short uuid> in the UI and hold NULL here, so deleting a draft
      -- cannot create a gap.
      add constraint %2$s_number_pairs_ordinal
        check ((doc_no is null) = (doc_ordinal is null)),
      add constraint %2$s_number_needs_series
        check (doc_no is null or series_id is not null),
      add constraint %2$s_amend_pair
        check ((amended_from is null) = (amend_seq = 0)),
      -- §3.3: the amended document carries the original's identity so it can be
      -- reported in a GSTR-1 amendment table (B2BA/CDNRA/...).
      add constraint %2$s_amend_carries_original
        check (amended_from is null
               or (original_doc_no is not null and original_doc_date is not null)),
      add constraint %2$s_cancel_stamp
        check ((docstatus = 2) = (cancelled_at is not null)),
      add constraint %2$s_cancel_reason
        check (docstatus <> 2 or nullif(btrim(cancel_reason), '') is not null),
      -- D9: a submitted document records the sealed ruleset that produced it.
      add constraint %2$s_ruleset_on_submit
        check (docstatus = 0 or ruleset_version_id is not null)
  $ddl$, p_schema, p_table);

  if p_requires_series then
    -- §3.6: numbers exist only on submitted/cancelled documents; drafts show
    -- DRAFT-<short uuid> in the UI and hold NULL here, so deleting a draft
    -- cannot create a gap.  The numbering mechanism is never reused for
    -- non-statutory documents, hence the conditional.
    execute format($ddl$
      alter table %1$I.%2$I
        add constraint %2$s_number_iff_submitted check ((docstatus = 0) = (doc_no is null))
    $ddl$, p_schema, p_table);
  end if;

  if p_is_statutory then
    -- The §143 route: gst_report_period is stamped at post time and is distinct
    -- from posting_date, so no document can silently land in a filed period's
    -- return.  The GSTR-1/3B builders read THIS column.
    execute format($ddl$
      alter table %1$I.%2$I
        add constraint %2$s_report_period_on_submit
          check (docstatus = 0 or gst_report_period is not null)
    $ddl$, p_schema, p_table);
  end if;

  -- §3.6: "That partial unique index goes on EVERY document table carrying a
  -- statutory series."  Gaplessness comes from the counter; uniqueness comes
  -- from here - a bug in the allocator, a restored backup or a hand-run UPDATE
  -- produces a duplicate the continuity auditor will not see.
  execute format(
    'create unique index %I on %I.%I (registration_id, doc_type, doc_no) where doc_no is not null',
    p_table || '_docno_uq', p_schema, p_table);
  execute format(
    'create unique index %I on %I.%I (series_id, doc_ordinal) where doc_ordinal is not null',
    p_table || '_ordinal_uq', p_schema, p_table);
  -- One live amendment per cancelled document.  See OPEN ITEM O-4.
  execute format(
    'create unique index %I on %I.%I (amended_from) where amended_from is not null',
    p_table || '_amend_uq', p_schema, p_table);
  execute format(
    'create index %I on %I.%I (company_id, posting_date, docstatus)',
    p_table || '_posting_ix', p_schema, p_table);
  execute format(
    'create index %I on %I.%I (registration_id, gst_report_period) where docstatus = 1',
    p_table || '_gstr_ix', p_schema, p_table);

  execute format(
    'create trigger %I before insert or update or delete on %I.%I
       for each row execute function erp.tg_document_spine()',
    p_table || '_spine', p_schema, p_table);

  insert into erp.document_type (
    doc_type, table_schema, table_name, is_statutory, requires_series,
    default_series_nature, allow_on_submit)
  values (p_doc_type, p_schema, p_table, p_is_statutory, p_requires_series,
          p_series_nature, coalesce(p_allow_on_submit, erp.default_allow_on_submit()));
end
$fn$;

-- ---------------------------------------------------------------------------
-- Government responses live in SIDE TABLES, not on the document.
-- The immutability trigger rejects any background job that would UPDATE a
-- submitted statutory document, so an asynchronous IRP call cannot write to it.
-- Append-only: retries add rows; nothing is ever overwritten.  This also gives
-- EWB the append-only lifecycle its Part-A/Part-B/extension sequence has.
-- ---------------------------------------------------------------------------
create table einvoice_artifact (
  id                uuid primary key,
  tenant_id         uuid not null default erp.this_tenant(),
  document_type     text not null references erp.document_type(doc_type),
  document_id       uuid not null,
  attempt_seq       int not null,
  status            text not null check (status in ('pending','generated','failed','cancelled')),
  irn               text,
  ack_no            text,
  ack_date          timestamptz,
  signed_invoice    text,
  signed_qr         text,
  irp_response      jsonb,
  error_code        text,
  error_class       smallint check (error_class in (1,2,3)),  -- D6 triage: 1 = permanently invalid, do not retry
  is_sandbox        boolean not null,
  ruleset_version_id uuid references ruleset_version(id),
  created_at        timestamptz not null default now(),
  created_by        uuid not null,
  constraint einvoice_attempt_uq unique (document_type, document_id, attempt_seq),
  constraint einvoice_generated_has_irn
    check (status <> 'generated' or (irn is not null and ack_no is not null and signed_qr is not null)),
  constraint einvoice_failed_has_code
    check (status <> 'failed' or error_code is not null)
);
create index einvoice_doc_ix on einvoice_artifact (document_id, attempt_seq desc);
-- Only one IRN may ever stand for a document.
create unique index einvoice_live_irn_uq
  on einvoice_artifact (document_type, document_id) where status = 'generated';
select erp.make_append_only('public', 'einvoice_artifact');

create table ewb_artifact (
  id             uuid primary key,
  tenant_id      uuid not null default erp.this_tenant(),
  document_type  text not null references erp.document_type(doc_type),
  document_id    uuid not null,
  attempt_seq    int not null,
  part_b_seq     int not null default 0,
  status         text not null check (status in ('pending','generated','part_b_updated',
                                                 'extended','failed','cancelled')),
  ewb_no         text,
  valid_upto     timestamptz,     -- EWB validity runs from GENERATION, not from document_date
  vehicle_no     text,
  transporter_id text,
  transport_mode text,
  distance_km    int,
  nic_response   jsonb,
  error_code     text,
  is_sandbox     boolean not null,
  ruleset_version_id uuid references ruleset_version(id),
  created_at     timestamptz not null default now(),
  created_by     uuid not null,
  constraint ewb_attempt_uq unique (document_type, document_id, attempt_seq, part_b_seq)
);
create index ewb_doc_ix on ewb_artifact (document_id, attempt_seq desc, part_b_seq desc);
select erp.make_append_only('public', 'ewb_artifact');

-- ---------------------------------------------------------------------------
-- §3.8: submit accepts an idempotency key; a retried submit returns the
-- original result rather than a second invoice.  Also the reconnect path for
-- the gate, weighbridge and shop-floor screens (§3.13).
-- ---------------------------------------------------------------------------
create table request_idempotency (
  idempotency_key text primary key,
  tenant_id       uuid not null default erp.this_tenant(),
  actor_user_id   uuid not null,
  request_hash    bytea not null,       -- refuse the key if the body differs
  entity          text not null,
  entity_id       uuid,
  response        jsonb,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- §3.8: a transactional outbox IN THE TENANT SCHEMA - enqueue-after-commit that
-- survives a Redis flush.  BullMQ reads from here, never directly from a
-- service call inside the posting transaction.
-- ---------------------------------------------------------------------------
create table outbox_message (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null default erp.this_tenant(),
  job_name      text not null,
  job_key       text not null,        -- namespaced; the dedup key
  payload       jsonb not null,
  available_at  timestamptz not null default now(),
  published_at  timestamptz,
  attempts      int not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  constraint outbox_job_key_uq unique (job_name, job_key)
);
create index outbox_pending_ix on outbox_message (available_at)
  where published_at is null;

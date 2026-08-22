-- ============================================================================
-- 040_numbering.sql   §3.6 / D2 / L8.  Statutory numbering.
--
-- Scope is the QUADRUPLE (GSTIN registration, document type, series code,
-- Indian FY).  One series per GSTIN per year is wrong: Rule 46(b) expressly
-- allows one OR multiple series, and every plant-plus-depot manufacturer runs
-- several.  series_code is a first-class tracked field on the document, chosen
-- at entry, never inferred from the document name by string arithmetic.
--
-- Two guarantees, deliberately separate:
--   GAPLESSNESS comes from the counter under a row lock (this file).
--   UNIQUENESS comes from the partial unique index on every document table
--     (050_document_spine.sql) plus document_number_register below.
-- A bug in the allocator, a restored backup or a hand-run UPDATE produces a
-- duplicate that the continuity auditor - which only checks for holes - will
-- not see.
--
-- Postgres SEQUENCE is REJECTED: rollback burns the number and produces an
-- unexplained gap in a GST series.
-- ============================================================================
\set ON_ERROR_STOP on

create table document_series (
  id              uuid primary key,
  tenant_id       uuid not null default erp.this_tenant(),
  registration_id uuid not null references gstin_registration(id),
  doc_type        text not null,
  series_code     text not null,          -- 'PLANT', 'DEPOT', 'EXP', 'GATE'
  series_nature   erp.series_nature not null,   -- what GSTR-1 Table 13 reports on
  fiscal_year_id  uuid not null references fiscal_year(id),
  format          text not null,          -- 'INV/{STATE}/{FY}/{#####}'
  start_ordinal   bigint not null default 1,    -- first ordinal THIS system issues
  current         bigint not null default 0,
  -- Mid-year cut-over.  The externally-issued range is DECLARED, not
  -- enumerated, and the continuity auditor asserts continuity only from
  -- start_ordinal forward.  Without these three columns a client going live on
  -- 1 October having issued 1-842 in Tally either fails the auditor forever or
  -- restarts the series mid-year, which is the audit finding the auditor exists
  -- to prevent.
  migrated_from   bigint,
  migrated_to     bigint,
  migration_note  text,                   -- source system, cut-over date, who
  is_disabled     boolean not null default false,
  created_at      timestamptz not null default now(),
  created_by      uuid not null,
  constraint document_series_scope_uq
    unique (registration_id, doc_type, series_code, fiscal_year_id),
  constraint document_series_current_ge_start
    check (current = 0 or current >= start_ordinal - 1),
  constraint document_series_migrated_pair
    check ((migrated_from is null) = (migrated_to is null)),
  constraint document_series_migrated_order
    check (migrated_to is null or migrated_to >= migrated_from),
  -- If an external range was declared, this system starts after it.
  constraint document_series_starts_after_migrated
    check (migrated_to is null or start_ordinal > migrated_to),
  constraint document_series_migration_needs_provenance
    check (migrated_from is null or nullif(btrim(migration_note), '') is not null)
);
create index document_series_reg_ix on document_series (registration_id, doc_type, fiscal_year_id);

-- ---------------------------------------------------------------------------
-- Format validation AT SERIES-DESIGN TIME (PHASE4 G7 / V8), never at issue
-- time.  Rule 46(b): <= 16 chars, alphanumeric first character, only - and /
-- thereafter.  The numeric token width is validated against the projected
-- annual volume so the series cannot overflow mid-year.  Retrofitting this
-- after customers have live series means renumbering live books.
--
-- Note: the plan writes the regex as ^[^\W_][A-Za-z0-9\-\/]{0,15}$.  In
-- Postgres ARE, \W inside a bracket expression is ambiguous, so it is spelled
-- out below.  Same language, unambiguous engine.
-- ---------------------------------------------------------------------------
create or replace function erp.render_doc_no(
  p_format text, p_ordinal bigint, p_fy_code text, p_state_code text, p_series_code text
) returns text
  language plpgsql immutable as
$fn$
declare s text := p_format; w int; tok text;
begin
  s := replace(s, '{FY}',     p_fy_code);
  s := replace(s, '{STATE}',  p_state_code);
  s := replace(s, '{SERIES}', p_series_code);
  tok := substring(s from '\{#+\}');       -- the '{#####}' token, braces included
  if tok is null then
    raise exception 'series format % has no numeric token', p_format using errcode = 'ERP21';
  end if;
  w := length(tok) - 2;
  if length(p_ordinal::text) > w then
    raise exception 'series ordinal % overflows a %-digit token in format %',
      p_ordinal, w, p_format using errcode = 'ERP20';
  end if;
  return replace(s, tok, lpad(p_ordinal::text, w, '0'));
end
$fn$;

create or replace function erp.tg_validate_series_format() returns trigger
  language plpgsql as
$fn$
declare fy fiscal_year%rowtype; reg gstin_registration%rowtype;
        sample text; max_ord bigint; tok text;
begin
  select * into fy  from fiscal_year         where id = new.fiscal_year_id;
  select * into reg from gstin_registration  where id = new.registration_id;

  tok := substring(new.format from '\{#+\}');
  if tok is null then
    raise exception 'series format % has no numeric token' , new.format using errcode = 'ERP21';
  end if;
  max_ord := (repeat('9', length(tok) - 2))::bigint;

  -- Validate BOTH ends of the series, not just the first number.
  sample := erp.render_doc_no(new.format, new.start_ordinal, fy.code, reg.state_code, new.series_code);
  if length(sample) > 16 or sample !~ '^[A-Za-z0-9][A-Za-z0-9/-]{0,15}$' then
    raise exception 'rendered document number % violates Rule 46(b) (<=16 chars, alnum first, only - and /)',
      sample using errcode = 'ERP21';
  end if;
  sample := erp.render_doc_no(new.format, max_ord, fy.code, reg.state_code, new.series_code);
  if length(sample) > 16 then
    raise exception 'series would overflow 16 chars at its last ordinal (%)', sample
      using errcode = 'ERP21';
  end if;
  return new;
end
$fn$;
create trigger document_series_format_valid
  before insert or update of format, start_ordinal, fiscal_year_id, series_code
  on document_series for each row execute function erp.tg_validate_series_format();

-- ---------------------------------------------------------------------------
-- document_number_register
--
-- NOT IN THE SOURCE PLAN.  Added because two things the plan REQUIRES have no
-- writable source without it:
--   (a) GSTR-1 Table 13 - "issued, cancelled, net, from-number, to-number per
--       series_nature per series" - is a cross-document-type report, and the
--       25+ statutory document tables cannot be aggregated without dynamic SQL.
--   (b) the continuity auditor asserts "an unbroken run from start_ordinal to
--       current per (registration, doc_type, series_code, FY)", which requires
--       enumerating issued ordinals; deriving them by parsing doc_no is exactly
--       the string arithmetic §3.6 forbids.
-- One row per number ever allocated.  Never deleted.  status flips to
-- 'cancelled' when the document is cancelled - and the number is never
-- returned to the pool (ERP23).
-- ---------------------------------------------------------------------------
create table document_number_register (
  series_id        uuid not null references document_series(id),
  ordinal          bigint not null,
  registration_id  uuid not null references gstin_registration(id),
  doc_type         text not null,
  series_nature    erp.series_nature not null,
  doc_no           text not null,
  document_id      uuid not null,
  gst_report_period erp.gst_period,       -- Table 13 is reported per return period
  status           text not null default 'issued'
                   check (status in ('issued','cancelled')),
  issued_at        timestamptz not null default now(),
  issued_by        uuid not null,
  cancelled_at     timestamptz,
  primary key (series_id, ordinal),
  constraint dnr_doc_uq unique (document_id),
  -- The uniqueness half of the numbering guarantee, enforced centrally as well
  -- as per-table.
  constraint dnr_number_uq unique (registration_id, doc_type, doc_no),
  constraint dnr_cancel_stamp check ((status = 'cancelled') = (cancelled_at is not null))
);
create index dnr_series_status_ix on document_number_register (series_id, status);

-- Only two mutations are legal: issue (insert) and cancel (one status flip).
create or replace function erp.tg_dnr_guard() returns trigger
  language plpgsql as
$fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'a consumed document number is never released (D2)' using errcode = 'ERP23';
  end if;
  if old.status = 'cancelled' then
    raise exception 'document number % is already cancelled', old.doc_no using errcode = 'ERP23';
  end if;
  if to_jsonb(old) - 'status' - 'cancelled_at' is distinct from to_jsonb(new) - 'status' - 'cancelled_at' then
    raise exception 'only the cancellation of a document number may be recorded'
      using errcode = 'ERP30';
  end if;
  return new;
end
$fn$;
create trigger dnr_guard before update or delete on document_number_register
  for each row execute function erp.tg_dnr_guard();

-- ---------------------------------------------------------------------------
-- The allocator.  ONE attempt, no sleeping inside the database.
--
-- §3.6 concurrency contract, restated so it can be tested:
--   * the lock is held until COMMIT, not "for microseconds" - SELECT ... FOR
--     UPDATE holds the row lock until the transaction ends, so throughput per
--     series is bounded by COMMIT LATENCY (~1/commit_latency submissions per
--     second; at 5 ms that is ~200/s).
--   * therefore the number is allocated LAST, after validate() and post(), so
--     validation and posting time are not under the lock.
--   * NOWAIT is used because a queued waiter would serialise behind the slowest
--     concurrent invoice - the exact failure PHASE5 §2.6 measures in Frappe.
--   * lock_not_available (55P03) ABORTS the transaction, so the caller MUST
--     wrap this call in a SAVEPOINT and roll back to it between retries.
--     Retry/backoff (25/50/100/200/400 ms, six attempts) is APPLICATION-side:
--     sleeping inside the database holds a pooled connection.
--
--   BEGIN
--     validate(doc);  post(gl, ple);            -- no series lock held
--     loop attempt in 1..6:
--       SAVEPOINT sp_series;
--       try:    select * from erp.allocate_doc_no(...); break
--       except lock_not_available:
--               ROLLBACK TO SAVEPOINT sp_series; sleep(jitter)
--     erp.audit_write(...)                      -- chain-head lock, same slot
--   COMMIT                                      -- both locks released here
-- ---------------------------------------------------------------------------
create or replace function erp.allocate_doc_no(
  p_series_id  uuid,
  p_document_id uuid,
  p_gst_report_period erp.gst_period default null
) returns table (ordinal bigint, doc_no text)
  language plpgsql as
$fn$
declare s document_series%rowtype; fy fiscal_year%rowtype; reg gstin_registration%rowtype;
        v_ord bigint; v_no text;
begin
  -- NOWAIT: raises 55P03 lock_not_available rather than queueing.
  select * into s from document_series where id = p_series_id for update nowait;
  if not found then
    raise exception 'document series % does not exist', p_series_id using errcode = 'ERP21';
  end if;
  if s.is_disabled then
    raise exception 'document series % is disabled', s.series_code using errcode = 'ERP21';
  end if;

  select * into fy  from fiscal_year        where id = s.fiscal_year_id;
  select * into reg from gstin_registration where id = s.registration_id;

  v_ord := greatest(s.current + 1, s.start_ordinal);
  v_no  := erp.render_doc_no(s.format, v_ord, fy.code, reg.state_code, s.series_code);

  update document_series set current = v_ord where id = p_series_id;

  insert into document_number_register (
    series_id, ordinal, registration_id, doc_type, series_nature, doc_no,
    document_id, gst_report_period, issued_by)
  values (p_series_id, v_ord, s.registration_id, s.doc_type, s.series_nature, v_no,
          p_document_id, p_gst_report_period, erp.actor());

  -- Rollback un-consumes the number because the counter UPDATE rolls back with
  -- the transaction.  Cancellation NEVER returns one.
  ordinal := v_ord; doc_no := v_no; return next;
end
$fn$;

-- Bulk path for the migrator ONLY.  L11's opening-invoice import cannot afford
-- one round trip per row against a lock bounded by commit latency, so it
-- reserves a single locked range per batch.
create or replace function erp.reserve_doc_no_range(p_series_id uuid, p_count int)
  returns table (from_ordinal bigint, to_ordinal bigint)
  language plpgsql as
$fn$
declare s document_series%rowtype;
begin
  if erp.posting_mode() <> 'migration' then
    raise exception 'bulk number reservation is available only in migration mode (L11)'
      using errcode = 'ERP61';
  end if;
  select * into s from document_series where id = p_series_id for update;
  from_ordinal := greatest(s.current + 1, s.start_ordinal);
  to_ordinal   := from_ordinal + p_count - 1;
  update document_series set current = to_ordinal where id = p_series_id;
  return next;
end
$fn$;

-- ---------------------------------------------------------------------------
-- Continuity auditor.  Locks prevent FUTURE gaps and never detect EXISTING
-- ones - restored backups, migrations and manual edits break sequences no lock
-- protects.  The blocker is the UNACKNOWLEDGED gap, never the gap.
-- ---------------------------------------------------------------------------
create table series_gap (
  id              uuid primary key,
  series_id       uuid not null references document_series(id),
  from_ordinal    bigint not null,
  to_ordinal      bigint not null,
  detected_at     timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  reason          text,
  constraint series_gap_order check (to_ordinal >= from_ordinal),
  constraint series_gap_uq unique (series_id, from_ordinal, to_ordinal),
  -- Acknowledgement is permanent and requires a reason; it never deletes the
  -- record and never removes the disclosure in Table 13.
  constraint series_gap_ack_complete
    check (num_nonnulls(acknowledged_at, acknowledged_by) in (0,2)
           and (acknowledged_at is null or nullif(btrim(reason), '') is not null))
);

create or replace function erp.tg_series_gap_permanent() returns trigger
  language plpgsql as
$fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'a series gap record is permanent; acknowledge it instead'
      using errcode = 'ERP30';
  end if;
  if old.acknowledged_at is not null then
    raise exception 'series gap % is already acknowledged', old.id using errcode = 'ERP30';
  end if;
  return new;
end
$fn$;
create trigger series_gap_permanent before update or delete on series_gap
  for each row execute function erp.tg_series_gap_permanent();

-- Nightly job: asserts an unbroken run from start_ordinal to current.
create or replace function erp.detect_series_gaps(p_series_id uuid default null)
  returns setof series_gap
  language plpgsql as
$fn$
declare s record; g record;
begin
  for s in select * from document_series
            where (p_series_id is null or id = p_series_id) and current >= start_ordinal loop
    for g in
      with missing as (
        select o from generate_series(s.start_ordinal, s.current) o
        except
        select ordinal from document_number_register where series_id = s.id)
      , grp as (select o, o - row_number() over (order by o) as island from missing)
      select min(o) as lo, max(o) as hi from grp group by island
    loop
      insert into series_gap (id, series_id, from_ordinal, to_ordinal)
      values (gen_random_uuid(), s.id, g.lo, g.hi)
      on conflict (series_id, from_ordinal, to_ordinal) do nothing;
    end loop;
  end loop;
  return query select * from series_gap where acknowledged_at is null;
end
$fn$;

-- Called before IRN generation and before any GSTR-1 export.  Blocks on the
-- UNACKNOWLEDGED gap only, so a support-team restore cannot silently convert
-- into a tenant that cannot invoice.
create or replace function erp.assert_series_clean(p_registration_id uuid)
  returns void language plpgsql stable as
$fn$
declare n int;
begin
  select count(*) into n
    from series_gap g join document_series s on s.id = g.series_id
   where s.registration_id = p_registration_id and g.acknowledged_at is null;
  if n > 0 then
    raise exception '% unacknowledged series gap(s) on registration %', n, p_registration_id
      using errcode = 'ERP22',
            hint = 'A supervisor may acknowledge with a reason; the gap stays disclosed in Table 13.';
  end if;
end
$fn$;

-- ---------------------------------------------------------------------------
-- GSTR-1 Table 13 - Documents Issued.  Per series_nature per series: issued,
-- cancelled, net, from-number, to-number.  The externally-issued (migrated)
-- range is reported as its own row for the cut-over period, exactly as §3.6
-- requires - which is why it is a UNION and not a filter.
-- ---------------------------------------------------------------------------
create view v_gstr1_table13 as
  select s.registration_id, s.fiscal_year_id, s.series_nature, s.series_code,
         'issued'::text as provenance,
         r.gst_report_period,
         min(r.doc_no) as from_no, max(r.doc_no) as to_no,
         count(*)                                        as total_issued,
         count(*) filter (where r.status = 'cancelled')   as cancelled,
         count(*) filter (where r.status = 'issued')      as net
    from document_series s
    join document_number_register r on r.series_id = s.id
   group by s.registration_id, s.fiscal_year_id, s.series_nature, s.series_code, r.gst_report_period
  union all
  select s.registration_id, s.fiscal_year_id, s.series_nature, s.series_code,
         'declared_external'::text, null::erp.gst_period,
         s.migrated_from::text, s.migrated_to::text,
         (s.migrated_to - s.migrated_from + 1), 0, (s.migrated_to - s.migrated_from + 1)
    from document_series s
   where s.migrated_from is not null;

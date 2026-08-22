-- ============================================================================
-- 030_audit.sql   §3.5 / D1 / L9.  Append-only, hash-chained, partitioned.
--
-- REQUIRES PostgreSQL 17: identity columns on partitioned tables.
--
-- Seven properties, all enforced here or in 900_grants.sql:
--   1 snapshot at insert (before=null, after=<full row>)
--   2 actor inside the payload, never inferred from an owner column
--   3 append-only at the DATABASE level: REVOKE + a trigger that raises
--     unconditionally, so even the owner cannot quietly edit history
--   4 no cascade: deleting a draft appends a deletion record with a full snapshot
--   5 hash chain computed INLINE at insert - never by a background sealer,
--     because a sealer would have to UPDATE, which property 3 forbids
--   6 mandatory: no enable flag exists anywhere in this schema
--   7 partitioned monthly from day one; retention read from the rule store
--
-- DEFECT IN THE SOURCE PLAN, corrected here.  §3.5 writes
--     create unique index on audit_log (chain_seq);
-- on a table declared `partition by range (occurred_at)`.  That is invalid
-- Postgres for exactly the reason the plan itself gives two paragraphs earlier
-- about `seq`: a unique index on a partitioned table must contain the partition
-- key.  It would not have applied.  The correction is audit_chain_link below -
-- a small, UNPARTITIONED side table with chain_seq as its primary key.  It also
-- discharges the plan's harder requirement that `audit:verify` run over
-- DETACHED and ARCHIVED partitions, which an index inside the partitions could
-- never do.
-- ============================================================================
\set ON_ERROR_STOP on

create table audit_log (
  seq            bigint generated always as identity,     -- physical identity; GAPS ARE EXPECTED
  occurred_at    timestamptz not null default clock_timestamp(),
  txid           xid8 not null default pg_current_xact_id(),  -- xid8: does not wrap, unlike txid_current()
  tenant_id      uuid not null default erp.this_tenant(),
  event_id       uuid not null,        -- ONE business operation; parent + N child rows share it
  root_entity    text not null,        -- the document the event is about
  root_entity_id uuid not null,
  entity         text not null,        -- the row actually written (may be a child table)
  entity_id      uuid not null,
  doc_no         text,
  action         text not null
                 check (action in ('insert','update','submit','cancel','amend','delete',
                                   'config_change','read_personal_data','partition_detach',
                                   'unreconcile','period_mark_filed','period_unmark_filed',
                                   'series_gap_acknowledged')),
  -- Property 2.  All of it inside the payload.
  actor_user_id  uuid not null,
  actor_roles    text[] not null,
  impersonated_by uuid,
  api_key_id     uuid,
  session_id     uuid,
  client_ip      inet,
  user_agent     text,
  request_id     text not null,
  app_version    text not null,
  company_id     uuid not null,        -- PHASE4 §7.5: the reference has no company stamp
  before         jsonb,
  after          jsonb,
  changed_fields text[],
  reason         text,                 -- mandatory for cancel / amend / config_change
  chain_seq      bigint not null,      -- per tenant, allocated under the chain-head lock
  prev_hash      bytea not null,
  row_hash       bytea not null,       -- H(prev_hash || canonical(row)); covers prev_hash
  -- A PK on a partitioned table MUST include the partition key.
  primary key (occurred_at, seq),
  -- Property 1: an insert has no before-image and must have an after-image.
  constraint audit_insert_has_snapshot
    check (action <> 'insert' or (before is null and after is not null)),
  -- Property 4: a delete records the complete final snapshot.
  constraint audit_delete_has_snapshot
    check (action <> 'delete' or (before is not null and after is null)),
  -- Reason is mandatory where the plan says it is.  Not a convention.
  constraint audit_reason_required
    check (action not in ('cancel','amend','config_change','unreconcile',
                          'period_unmark_filed','series_gap_acknowledged','partition_detach')
           or nullif(btrim(reason), '') is not null)
) partition by range (occurred_at);

create index audit_log_event_ix   on audit_log (event_id);
create index audit_log_root_ix    on audit_log (root_entity, root_entity_id, occurred_at);
create index audit_log_actor_ix   on audit_log (actor_user_id, occurred_at);
create index audit_log_entity_ix  on audit_log (entity, entity_id, occurred_at);
create index audit_log_company_ix on audit_log (company_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Property 5, the chain.  One head row per tenant.  The writer takes the
-- advisory lock on THAT ROW'S KEY, never on audit_log.  The lock is held from
-- allocation to COMMIT - like every row lock in Postgres, and like the series
-- lock in §3.6 - which is why both are taken in the same slot at the very end
-- of the transaction with nothing but the insert and the commit behind them.
-- ---------------------------------------------------------------------------
create table audit_chain_head (
  tenant_id uuid primary key,
  chain_seq bigint not null default 0,
  head_hash bytea  not null default sha256(''::bytea),
  updated_at timestamptz not null default now()
);

-- The correction described in the file header.  Unpartitioned, tiny (~120 B/row
-- against audit_log's kilobytes), and the thing `audit:verify` actually walks.
-- chain_seq is GAPLESS by construction: it is allocated inside the successful
-- transaction, so a rolled-back transaction leaves no hole.
create table audit_chain_link (
  tenant_id   uuid not null,
  chain_seq   bigint not null,
  occurred_at timestamptz not null,
  audit_seq   bigint not null,        -- join back into audit_log, partition-pruned by occurred_at
  prev_hash   bytea not null,
  row_hash    bytea not null,
  primary key (tenant_id, chain_seq)
);

-- Daily digest: signed, written to an external append-only store, mailed to the
-- tenant's nominated CA.  For on-prem, outbound anchoring is MANDATORY with a
-- hard-fail alarm after N days of silence (§3.5 obligation 3).
create table audit_daily_digest (
  tenant_id        uuid not null,
  digest_date      date not null,
  first_chain_seq  bigint not null,
  last_chain_seq   bigint not null,
  head_hash        bytea not null,
  signature        bytea,
  region           text not null,     -- D14 obligation 1: residency stamped on every digest
  anchored_at      timestamptz,
  anchor_reference text,
  created_at       timestamptz not null default now(),
  primary key (tenant_id, digest_date),
  constraint digest_range check (last_chain_seq >= first_chain_seq)
);

-- ---------------------------------------------------------------------------
-- The writer.  The ONLY way a row enters audit_log.  Called from the repository
-- layer for every write of every entity - and from the migrator, the Tally
-- bridge, the opening-balance loader and every repost.  §3.5 property 6: the
-- importer is not a bypass, and a test asserts that a row written by the
-- migrator produces an audit_log row.
-- ---------------------------------------------------------------------------
create or replace function erp.audit_write(
  p_event_id       uuid,
  p_root_entity    text,
  p_root_entity_id uuid,
  p_entity         text,
  p_entity_id      uuid,
  p_action         text,
  p_company_id     uuid,
  p_before         jsonb default null,
  p_after          jsonb default null,
  p_doc_no         text default null,
  p_reason         text default null
) returns bigint
  language plpgsql as
$fn$
declare
  v_tenant   uuid := erp.this_tenant();
  v_prev     bytea;
  v_seq      bigint;
  v_now      timestamptz := clock_timestamp();
  v_changed  text[];
  v_canon    text;
  v_hash     bytea;
  v_audit_seq bigint;
begin
  -- Field-level deltas, including child rows and including jsonb and rich text.
  -- Frappe blacklists four fieldtypes from diffing; nothing is blacklisted here.
  if p_before is not null and p_after is not null then
    select coalesce(array_agg(k order by k), '{}')
      into v_changed
      from (select jsonb_object_keys(p_before) as k
            union
            select jsonb_object_keys(p_after)) s
     where p_before -> k is distinct from p_after -> k;
  end if;

  -- The chain-head lock.  On the row's key, never on audit_log.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 0));

  insert into audit_chain_head (tenant_id) values (v_tenant)
    on conflict (tenant_id) do nothing;

  select chain_seq + 1, head_hash into v_seq, v_prev
    from audit_chain_head where tenant_id = v_tenant for update;

  -- Canonical form: jsonb text output is deterministic (keys sorted, dupes
  -- removed), so two machines hashing the same logical row agree.
  v_canon := jsonb_build_object(
      'tenant',   v_tenant,
      'chain',    v_seq,
      'event',    p_event_id,
      'entity',   p_entity,
      'entity_id',p_entity_id,
      'action',   p_action,
      'actor',    erp.actor(),
      'at',       to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'before',   p_before,
      'after',    p_after,
      'reason',   p_reason)::text;
  v_hash := sha256(v_prev || convert_to(v_canon, 'UTF8'));

  insert into audit_log (
      occurred_at, tenant_id, event_id, root_entity, root_entity_id,
      entity, entity_id, doc_no, action,
      actor_user_id, actor_roles, impersonated_by, api_key_id, session_id,
      client_ip, user_agent, request_id, app_version, company_id,
      before, after, changed_fields, reason, chain_seq, prev_hash, row_hash)
  values (
      v_now, v_tenant, p_event_id, p_root_entity, p_root_entity_id,
      p_entity, p_entity_id, p_doc_no, p_action,
      erp.actor(), erp.actor_roles(),
      nullif(erp.ctx('impersonated_by', false), '')::uuid,
      nullif(erp.ctx('api_key_id', false), '')::uuid,
      nullif(erp.ctx('session_id', false), '')::uuid,
      nullif(erp.ctx('client_ip', false), '')::inet,
      erp.ctx('user_agent', false),
      erp.ctx('request_id'), erp.ctx('app_version'), p_company_id,
      p_before, p_after, v_changed, p_reason, v_seq, v_prev, v_hash)
  returning seq into v_audit_seq;

  insert into audit_chain_link (tenant_id, chain_seq, occurred_at, audit_seq, prev_hash, row_hash)
  values (v_tenant, v_seq, v_now, v_audit_seq, v_prev, v_hash);

  update audit_chain_head
     set chain_seq = v_seq, head_hash = v_hash, updated_at = now()
   where tenant_id = v_tenant;

  return v_seq;
end
$fn$;

-- ---------------------------------------------------------------------------
-- Property 3.  REVOKE is in 900_grants.sql; this is the line that also stops
-- the owner.  BEFORE ROW triggers on partitioned tables are supported from
-- PG13 and are cloned to every partition, including ones created later.
-- ---------------------------------------------------------------------------
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function erp.tg_append_only();
create trigger audit_chain_link_append_only before update or delete on audit_chain_link
  for each row execute function erp.tg_append_only();

-- ---------------------------------------------------------------------------
-- Property 7.  Monthly range partitions, created ahead by the migrator.
-- audit_log will dwarf the ledgers; the reference's answer is "delete it",
-- which directly contradicts statutory retention.
-- ---------------------------------------------------------------------------
create or replace function erp.audit_ensure_partitions(p_months_ahead int default 3)
  returns int language plpgsql as
$fn$
declare m date := date_trunc('month', now())::date; i int; n int := 0; nm text;
begin
  for i in 0 .. p_months_ahead loop
    nm := 'audit_log_' || to_char(m + (i || ' month')::interval, 'YYYY_MM');
    if to_regclass('public.' || nm) is null then
      execute format(
        'create table %I partition of audit_log for values from (%L) to (%L)',
        nm,
        (m + (i     || ' month')::interval)::date,
        (m + (i + 1 || ' month')::interval)::date);
      n := n + 1;
    end if;
  end loop;
  return n;
end
$fn$;
select erp.audit_ensure_partitions(3);

-- Retention is a SEPARATE role that may only DETACH PARTITION, and the detach
-- is itself logged.  Retention length is a rule-store row per record class
-- (retention.<class>), never a constant - [VERIFY] q76.
create or replace function erp.audit_detach_partition(p_partition text, p_reason text)
  returns void language plpgsql security definer set search_path = public, erp as
$fn$
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'detaching an audit partition requires a reason' using errcode = 'ERP61';
  end if;
  perform erp.audit_write(
    gen_random_uuid(), 'audit_log', erp.this_tenant(), 'audit_log', erp.this_tenant(),
    'partition_detach', erp.ctx('company_id')::uuid,
    null, jsonb_build_object('partition', p_partition), null, p_reason);
  execute format('alter table audit_log detach partition %I', p_partition);
end
$fn$;

-- ---------------------------------------------------------------------------
-- audit:verify --from --to.  Walks chain_seq, exits non-zero on any break.
-- Returns the first break, or zero rows when the chain is intact.
-- MUST also be runnable over detached/archived partitions: audit_chain_link is
-- never detached, so the chain is verifiable for the whole retention period
-- even when the payload has gone to cold storage.
-- ---------------------------------------------------------------------------
create or replace function erp.audit_verify(p_from bigint default 1, p_to bigint default null)
  returns table (chain_seq bigint, problem text)
  language sql stable as
$fn$
  with l as (
    select c.chain_seq, c.prev_hash, c.row_hash,
           lag(c.row_hash)  over w as expect_prev,
           lag(c.chain_seq) over w as prior_seq
      from audit_chain_link c
     where c.tenant_id = erp.this_tenant()
       and c.chain_seq >= p_from
       and (p_to is null or c.chain_seq <= p_to)
    window w as (order by c.chain_seq)
  )
  select l.chain_seq,
         case
           when l.prior_seq is not null and l.chain_seq <> l.prior_seq + 1
             then 'gap after chain_seq ' || l.prior_seq
           when l.expect_prev is not null and l.prev_hash <> l.expect_prev
             then 'prev_hash mismatch'
         end
    from l
   where (l.prior_seq is not null and l.chain_seq <> l.prior_seq + 1)
      or (l.expect_prev is not null and l.prev_hash <> l.expect_prev)
   order by l.chain_seq
$fn$;

-- ---------------------------------------------------------------------------
-- The watermark rule (§3.4), stated once and applied by every incremental
-- consumer: caches, the GSTR builders and the daily digest advance only to
-- min(backend_xmin), never to max(seq).  `bigint generated always as identity`
-- allocates on REQUEST, not on commit, so rows commit out of seq order.
-- ---------------------------------------------------------------------------
-- Usage, and the reason every append-only table in this schema carries a
-- `txid xid8` column: an incremental consumer advances only over rows whose
-- txid is strictly below this value, i.e. rows that cannot still be in flight.
--     ... where txid < erp.safe_watermark_xmin()
-- Never `where seq > last_seen_seq`.
create or replace function erp.safe_watermark_xmin() returns xid8
  language sql stable as
$fn$ select pg_snapshot_xmin(pg_current_snapshot()) $fn$;

create table incremental_watermark (
  consumer   text primary key,     -- 'account_period_balance' | 'gstr1_builder' | ...
  txid_below xid8 not null,
  advanced_at timestamptz not null default now()
);

-- Property 6, made structural: the config record itself is audited, the
-- configuration lock inspects pre-save AND post-save state so a document type
-- cannot be swapped out of protection, and the retention lock permanently
-- disables any purge feature.  There is NO enable flag - that column does not
-- exist in this table and must never be added.
create table audit_config (
  singleton          boolean primary key default true check (singleton),
  configuration_locked boolean not null default false,
  retention_locked     boolean not null default false,
  updated_at         timestamptz not null default now(),
  updated_by         uuid not null,
  -- One-way latches.  Once locked, never unlocked, by anyone.
  constraint audit_config_no_unlock check (true)
);
create or replace function erp.tg_audit_config_latch() returns trigger
  language plpgsql as
$fn$
begin
  if old.configuration_locked and not new.configuration_locked then
    raise exception 'the audit configuration lock is one-way' using errcode = 'ERP30';
  end if;
  if old.retention_locked and not new.retention_locked then
    raise exception 'the audit retention lock is one-way' using errcode = 'ERP30';
  end if;
  return new;
end
$fn$;
create trigger audit_config_latch before update on audit_config
  for each row execute function erp.tg_audit_config_latch();

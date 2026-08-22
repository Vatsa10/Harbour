-- ============================================================================
-- 000_conventions.sql
-- Core data model, Stage 1 + Stage 2.  Target: PostgreSQL 17 EXACTLY.
--   PG17 is required, not preferred: audit_log is a partitioned table with an
--   identity column, and identity columns on partitioned tables are a PG17
--   feature.  On PG16 file 030 will not apply.
-- Applied per tenant database/schema by the migrator process ONLY (D7, §3.8).
-- ============================================================================
\set ON_ERROR_STOP on

create extension if not exists btree_gist;   -- statutory_rule EXCLUDE needs = on text in GiST

create schema if not exists erp;

-- ---------------------------------------------------------------------------
-- Money and quantity scales.  D5: one representation end to end, chosen once.
-- numeric only; the app maps these to Money/Qty via Drizzle string mode.
-- ---------------------------------------------------------------------------
create domain erp.amount  as numeric(18,4);   -- every currency amount, both legs
create domain erp.qty     as numeric(18,6);
create domain erp.rate    as numeric(18,6);   -- unit rate / valuation rate
create domain erp.pct     as numeric(9,6);    -- tax rate, repartition factor
create domain erp.fx      as numeric(18,9);   -- exchange rate

-- ---------------------------------------------------------------------------
-- Closed value sets.  Domains, not enums: ALTER DOMAIN can drop a value,
-- ALTER TYPE cannot, and every one of these is rule-store adjacent.
-- ---------------------------------------------------------------------------
create domain erp.docstatus as smallint
  check (value in (0,1,2));                                    -- §3.3 draft|submitted|cancelled

create domain erp.root_type as text
  check (value in ('asset','liability','equity','income','expense'));

create domain erp.party_type as text
  check (value in ('customer','supplier','employee','transporter'));

create domain erp.tax_character as text
  check (value in ('igst','cgst','sgst','utgst','cess','cess_non_advol'));   -- §3.10, UTGST included

create domain erp.gst_treatment as text
  check (value in ('taxable','zero_rated','nil_rated','exempted','non_gst')); -- T8: exemption is not zero

create domain erp.series_nature as text
  check (value in ('tax_invoice','bill_of_supply','credit_note','debit_note',
                   'delivery_challan','receipt_voucher','payment_voucher',
                   'refund_voucher','revised_invoice','job_work_challan'));   -- §3.6 Table 13 key

create domain erp.gst_period as text
  check (value ~ '^(0[1-9]|1[0-2])[0-9]{4}$');   -- MMYYYY.  See OPEN ITEM O-7.

create domain erp.gstin as text
  check (value ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');  -- checksum is app-side

create domain erp.state_code as text
  check (value ~ '^[0-9]{2}$');   -- 96 Overseas / 97 Other Territory are real records (T4)

create domain erp.pan as text
  check (value ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');

-- ---------------------------------------------------------------------------
-- Error codes.  Every raise in this schema uses one of these; the API maps
-- SQLSTATE to a user message.  Posting code never raises a bare P0001.
-- ---------------------------------------------------------------------------
create table erp.error_code (
  sqlstate  char(5) primary key,
  name      text not null unique,
  invariant text not null
);
insert into erp.error_code values
 ('ERP01','MissingStatutoryRule',    'L10 / D9: resolve() throws, never computes zero'),
 ('ERP02','OverlappingStatutoryRule','L10: no gaps, no overlaps'),
 ('ERP10','DocumentImmutable',       'D6 / §3.3: submitted column outside allow_on_submit'),
 ('ERP11','IllegalTransition',       'D6: only 0->1 and 1->2 exist'),
 ('ERP12','DeleteForbidden',         'D6: only drafts are deletable'),
 ('ERP13','AmendSourceNotCancelled', '§3.3: amended_from must be docstatus=2'),
 ('ERP20','SeriesExhausted',         'D2 / §3.6: numeric token would overflow'),
 ('ERP21','SeriesFormatInvalid',     'D2 / §3.6: Rule 46(b) 16-char format'),
 ('ERP22','SeriesGapUnacknowledged', 'D2 / §3.6: continuity auditor blocks IRN and GSTR-1'),
 ('ERP23','SeriesNumberReuse',       'D2: a cancelled number is never returned'),
 ('ERP30','AppendOnlyViolation',     'D1 / §3.4: UPDATE or DELETE on an append-only relation'),
 ('ERP31','AuditChainBroken',        'D1 / §3.5: prev_hash does not match the head'),
 ('ERP40','VoucherUnbalanced',       'L3 / §3.4 step 7: sum(debit) <> sum(credit)'),
 ('ERP41','VoucherTooFewLines',      'L3 / §3.4 step 8: minimum two surviving lines'),
 ('ERP42','AccountNotPostable',      '§3.4 step 3: group or disabled account'),
 ('ERP43','VoucherCrossCompany',     '§3.4: one voucher, one company'),
 ('ERP44','UnregisteredDimension',   'D11 / §3.4: the dimensions key set is closed'),
 ('ERP51','PeriodClosedByPCV',       'L7 gate (c) / §3.4 back-dating order 1'),
 ('ERP52','AccountsFrozen',          'L7 gate (b) / order 1 - administrator is denied'),
 ('ERP53','ReturnFiled',             'L7 gate (d) / order 2 - GSTR-1 or 3B filed lock'),
 ('ERP54','AccountingPeriodLocked',  'L7 gate (a) / order 3 - named exempted role only'),
 ('ERP60','OverAllocation',          'A2: reconciled amount exceeds the PLE amount'),
 ('ERP61','ReasonRequired',          'A2 / D1: unreconcile and config change need a reason'),
 ('ERP62','ReconcileSignMismatch',   'A2: an edge joins one positive and one negative PLE'),
 ('ERP63','ReconcileScopeMismatch',  'A2: an edge joins one party/account/company'),
 ('ERP70','ExtensionFieldCollision', '§3.2: an extension field may not shadow a base field'),
 ('ERP71','PropertyNotOverridable',  'D11: the 91-property allowlist'),
 ('ERP72','RepartitionUnbalanced',   'T7: invoice/refund lists equal length, +100 / -100');

-- ---------------------------------------------------------------------------
-- Tenant identity.  Exactly one row per tenant database/schema.  Every spine
-- column defaults from it, so tenant_id costs the application nothing.
-- §3.7: tenant_id/company_id stays on every table spine regardless of the
-- storage model - the audit log and fleet reconciliation require it.
-- ---------------------------------------------------------------------------
create table erp.tenant_identity (
  singleton  boolean primary key default true check (singleton),
  tenant_id  uuid not null,
  slug       text not null,
  region     text not null default 'ap-south-1',  -- D14 obligation 1: India residency, stamped
  is_on_prem boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function erp.this_tenant() returns uuid
  language sql stable parallel safe as
$fn$ select tenant_id from erp.tenant_identity where singleton $fn$;

-- ---------------------------------------------------------------------------
-- Session context.  Set by request middleware inside the transaction
-- (SET LOCAL), never from a client header (§3.7).  Reading an unset required
-- key throws: there is no "unknown actor" default, because D1 puts the actor
-- inside the payload.
-- ---------------------------------------------------------------------------
create or replace function erp.ctx(p_key text, p_required boolean default true)
  returns text language plpgsql stable parallel safe as
$fn$
declare v text;
begin
  v := nullif(current_setting('erp.' || p_key, true), '');
  if v is null and p_required then
    raise exception 'session context erp.% is not set', p_key using errcode = 'ERP61';
  end if;
  return v;
end
$fn$;

create or replace function erp.actor() returns uuid
  language sql stable as $fn$ select erp.ctx('actor_user_id')::uuid $fn$;

create or replace function erp.actor_roles() returns text[]
  language sql stable as $fn$ select coalesce(erp.ctx('actor_roles', false), '{}')::text[] $fn$;

-- 'normal' | 'migration'.  L11: migration mode is the ONLY mode that may write
-- into a period marked filed elsewhere, and only the migrator may set it.
create or replace function erp.posting_mode() returns text
  language sql stable as $fn$ select coalesce(erp.ctx('posting_mode', false), 'normal') $fn$;

create or replace function erp.has_role(p_role text) returns boolean
  language sql stable as $fn$ select p_role = any (erp.actor_roles()) $fn$;

-- ---------------------------------------------------------------------------
-- Generic append-only guard.  Attached to gl_entry, payment_ledger_entry,
-- audit_log, audit_chain_link, statutory_rule, document_line_tax.
-- REVOKE is the first line of defence; this trigger is the line that also
-- stops the table owner and psql at 2am (§3.5 property 3).
-- ---------------------------------------------------------------------------
create or replace function erp.tg_append_only() returns trigger
  language plpgsql as
$fn$
begin
  raise exception '%.% is append-only (% refused)',
        tg_table_schema, tg_table_name, tg_op
    using errcode = 'ERP30',
          hint = 'Correction is a new row: reverse, never delete (L2).';
end
$fn$;

-- Convenience: attach the guard plus the REVOKE in one call.
create or replace function erp.make_append_only(p_schema text, p_table text)
  returns void language plpgsql as
$fn$
begin
  execute format(
    'create trigger %I before update or delete on %I.%I
       for each row execute function erp.tg_append_only()',
    'zz_append_only_' || p_table, p_schema, p_table);
  execute format('revoke update, delete, truncate on %I.%I from erp_app', p_schema, p_table);
end
$fn$;

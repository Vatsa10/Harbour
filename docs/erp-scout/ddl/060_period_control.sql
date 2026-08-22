-- ============================================================================
-- 060_period_control.sql   L7 / §3.4 step 2 / §3.4 back-dating table.
--
-- Four orthogonal gates, evaluated in ONE precedence order, and the FIRST
-- REFUSAL WINS.  There is no window that overrides another:
--
--  Order  Window                                      Who may move it
--  1      Period Closing Voucher / accounts_frozen_till  Nobody. Administrator
--                                                        is explicitly denied.
--  2      GSTR-1 / 3B filed lock on (GSTIN, period)      Nobody; un-marked only
--                                                        by an audited supervisor action.
--  3      Accounting-period document lock               The named exempted role, audited.
--  4      stock_frozen_upto (per warehouse)             Warehouse supervisor - STAGE 3,
--                                                        not in this file.
--
-- Gate (d) needed a WRITER, which the reference did not have: it learns filing
-- status from the portal's Returns state machine, which sits behind an
-- OTP-authenticated session deferred to v1.5, so the gate read a field nothing
-- wrote.  Corrected: "mark period filed" is an explicit, audited action
-- requiring the ARN and the filing date as attached evidence, with a mandatory
-- reason.  NOTHING ELSE SETS IT.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- gstr_log   Gate (d)'s only writer, and the base of the s.16(4) walk.
-- L11 path 5 imports the opening filed-return register into this table: on day
-- one it had nothing to read.
-- ---------------------------------------------------------------------------
create table gstr_log (
  id              uuid primary key,
  tenant_id       uuid not null default erp.this_tenant(),
  registration_id uuid not null references gstin_registration(id),
  return_type     text not null check (return_type in ('gstr1','gstr3b','gstr9','cmp08','itc04')),
  return_period   erp.gst_period not null,
  filing_status   text not null default 'open'
                  check (filing_status in ('open','prepared','filed')),
  arn             text,
  filed_on        date,
  marked_by       uuid,
  marked_at       timestamptz,
  reason          text,
  -- PHASE4 §4.5: any write touching a period whose return log exists clears
  -- this flag, and the GSTR workbench shows the divergence rather than silently
  -- regenerating.
  is_latest_data  boolean not null default true,
  invalidated_at  timestamptz,
  is_opening      boolean not null default false,   -- L11 path 5 import marker
  created_at      timestamptz not null default now(),
  created_by      uuid not null,
  constraint gstr_log_uq unique (registration_id, return_type, return_period),
  -- Filing requires evidence.  A boolean with no ARN is how the books and the
  -- filed return diverge with no reconciliation path back.
  constraint gstr_log_filed_needs_evidence
    check (filing_status <> 'filed'
           or (arn is not null and filed_on is not null
               and marked_by is not null and marked_at is not null
               and nullif(btrim(reason), '') is not null)),
  constraint gstr_log_stale_stamp
    check (is_latest_data or invalidated_at is not null)
);
create index gstr_log_period_ix on gstr_log (registration_id, return_period);

-- Un-marking a filed period is a supervisor action with a reason, and the
-- un-mark is itself audited.  Enforced here so no other code path can do it.
create or replace function erp.tg_gstr_log_guard() returns trigger
  language plpgsql as
$fn$
begin
  if old.filing_status = 'filed' and new.filing_status <> 'filed' then
    if not erp.has_role('gst_supervisor') then
      raise exception 'un-marking a filed return requires the gst_supervisor role'
        using errcode = 'ERP53';
    end if;
    if nullif(btrim(new.reason), '') is null or new.reason = old.reason then
      raise exception 'un-marking a filed return requires a NEW reason' using errcode = 'ERP61';
    end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'a return log row is never deleted' using errcode = 'ERP30';
  end if;
  return new;
end
$fn$;
create trigger gstr_log_guard before update or delete on gstr_log
  for each row execute function erp.tg_gstr_log_guard();

-- ---------------------------------------------------------------------------
-- period_closing_voucher   Gate (c).  Reversing a PCV is a DOCUMENT, not a
-- setting - so this table carries the spine and is cancelled, never edited.
-- ---------------------------------------------------------------------------
create table period_closing_voucher (
  id                 uuid primary key,
  fiscal_year_id     uuid not null references fiscal_year(id),
  closing_account_id uuid not null references account(id),
  cost_center_id     uuid not null references cost_center(id),
  remarks            text
);
select erp.add_document_spine(
  'public','period_closing_voucher','period_closing_voucher',
  p_is_statutory := false, p_requires_series := false);

-- ---------------------------------------------------------------------------
-- The gate function.  Called by the posting chokepoint BEFORE ANY MATH
-- (§3.4 step 2), and again as a BEFORE INSERT trigger on gl_entry - because
-- "psql at 2am" is a stated threat and a service-layer guard is not sufficient
-- for a compliance argument.
-- ---------------------------------------------------------------------------
create or replace function erp.assert_period_open(
  p_company_id      uuid,
  p_registration_id uuid,
  p_posting_date    date,
  p_gst_report_period erp.gst_period,
  p_voucher_type    text
) returns void
  language plpgsql stable as
$fn$
declare
  dt   erp.document_type%rowtype;
  d    date;
  ap   accounting_period%rowtype;
  n    int;
  v_migration boolean := (erp.posting_mode() = 'migration');
begin
  select * into dt from erp.document_type where doc_type = p_voucher_type;

  -- ---- Order 1a: Period Closing Voucher -----------------------------------
  select max(pcv.posting_date) into d
    from period_closing_voucher pcv
   where pcv.company_id = p_company_id and pcv.docstatus = 1;
  if d is not null and p_posting_date <= d then
    raise exception 'period closed by a Period Closing Voucher dated %', d
      using errcode = 'ERP51',
            hint = 'Reversing a PCV is a document, not a setting. Nobody may move this window.';
  end if;

  -- ---- Order 1b: accounts_frozen_till -------------------------------------
  select accounts_frozen_till into d from company_accounts_settings where company_id = p_company_id;
  if d is not null and p_posting_date <= d then
    -- The ONE named exemption is keyed to a VOUCHER TYPE, not to a role
    -- (deemed_supply_143), and administrator is explicitly denied.
    if not coalesce(dt.may_bypass_frozen_accounts, false) then
      raise exception 'accounts are frozen up to % (posting_date %)', d, p_posting_date
        using errcode = 'ERP52',
              hint = 'The administrator is explicitly denied this bypass (§3.4).';
    end if;
  end if;

  -- ---- Order 2: GSTR-1 / 3B filed lock ------------------------------------
  if p_gst_report_period is not null then
    select count(*) into n
      from gstr_log g
     where g.registration_id = p_registration_id
       and g.return_period = p_gst_report_period
       and g.filing_status = 'filed';
    if n > 0
       and not coalesce(dt.may_bypass_filed_return, false)
       -- L11: is_migration is the ONLY mode that may write into a period marked
       -- filed elsewhere, and only the migrator may set it.
       and not v_migration then
      raise exception 'return period % is already filed for registration %',
        p_gst_report_period, p_registration_id
        using errcode = 'ERP53',
              hint = 'The remedy is a s.34 credit/debit note or an amendment row, never a cancel (§3.3a).';
    end if;
  end if;

  -- ---- Order 3: accounting-period document lock ---------------------------
  select * into ap from accounting_period
   where company_id = p_company_id
     and p_posting_date between from_date and to_date
     and is_document_locked;
  if found and not (erp.actor_roles() && ap.exempted_roles) then
    raise exception 'accounting period % is document-locked', ap.name
      using errcode = 'ERP54';
  end if;
end
$fn$;

-- PHASE4 §4.5 is_latest_data invalidation: any write touching a period whose
-- return log exists clears the flag on that log.  Called by the posting
-- chokepoint after a successful post; also safe to call from the repost job.
create or replace function erp.invalidate_return_period(
  p_registration_id uuid, p_period erp.gst_period)
  returns void language sql as
$fn$
  update gstr_log
     set is_latest_data = false, invalidated_at = now()
   where registration_id = p_registration_id
     and return_period = p_period
     and is_latest_data
$fn$;

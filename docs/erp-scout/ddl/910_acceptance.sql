-- ============================================================================
-- 910_acceptance.sql   The acceptance criteria, as an executable suite.
-- Run against a freshly migrated database.  It seeds a minimal company and then
-- asserts every invariant this schema claims to enforce.  Any FAIL is a defect
-- in the migration, not in the test.
--
--   psql -d <tenant> -v ON_ERROR_STOP=1 -f 910_acceptance.sql
--
-- Exits non-zero on the first failure.
-- ============================================================================
\set ON_ERROR_STOP on

-- Assertion helper: run p_sql and require it to fail with p_sqlstate.
create or replace function erp.expect_error(p_label text, p_sql text, p_sqlstate text)
  returns void language plpgsql as
$fn$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate then
      raise notice 'PASS  % (%)', p_label, p_sqlstate;
      return;
    end if;
    raise exception 'FAIL  %: expected % got % - %', p_label, p_sqlstate, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  %: expected % but the statement succeeded', p_label, p_sqlstate;
end
$fn$;

create or replace function erp.expect_ok(p_label text, p_sql text)
  returns void language plpgsql as
$fn$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
end
$fn$;

-- --------------------------------------------------------------------- seed
set erp.actor_user_id     = '00000000-0000-7000-8000-000000000001';
set erp.actor_roles       = '{accountant}';
set erp.request_id        = 'acceptance';
set erp.app_version       = '0.0.0-test';
set erp.company_id        = '00000000-0000-7000-8000-00000000a0c0';

insert into erp.tenant_identity (tenant_id, slug)
  values ('00000000-0000-7000-8000-00000000ffff', 'acceptance')
  on conflict do nothing;

do $seed$
declare
  v_actor uuid := '00000000-0000-7000-8000-000000000001';
  v_co    uuid := '00000000-0000-7000-8000-00000000a0c0';
  v_reg   uuid := '00000000-0000-7000-8000-00000000a0e0';
  v_fy    uuid := '00000000-0000-7000-8000-00000000a0f0';
  v_cc    uuid := '00000000-0000-7000-8000-00000000a0cc';
  v_ar    uuid := '00000000-0000-7000-8000-00000000a001';
  v_sales uuid := '00000000-0000-7000-8000-00000000a002';
  v_rs    uuid := '00000000-0000-7000-8000-00000000a0f5';
begin
  insert into company (id, code, legal_name, pan, books_start_date, created_by, updated_by)
    values (v_co, 'ACME', 'Acme Fabricators Pvt Ltd', 'AAAAA1111A', '2025-04-01', v_actor, v_actor);
  insert into gstin_registration (id, company_id, gstin, state_code, legal_name,
                                  registration_type, effective_from, created_by)
    values (v_reg, v_co, '27AAAAA1111A1Z5', '27', 'Acme Fabricators Pvt Ltd',
            'regular', '2025-04-01', v_actor);
  insert into fiscal_year (id, company_id, code, from_date, to_date)
    values (v_fy, v_co, '2025-26', '2025-04-01', '2026-03-31');
  insert into cost_center (id, company_id, code, name, is_default, created_by)
    values (v_cc, v_co, 'MAIN', 'Main', true, v_actor);
  insert into account (id, company_id, code, name, root_type, account_type, created_by, updated_by)
    values (v_ar,    v_co, '1310', 'Debtors',    'asset',  'receivable', v_actor, v_actor),
           (v_sales, v_co, '4010', 'Sales',      'income', null,         v_actor, v_actor);
  insert into company_accounts_settings (company_id, updated_by) values (v_co, v_actor);
  insert into ruleset_version (id, label, sealed_at, digest, signed_by)
    values (v_rs, 'test-ruleset', now(), sha256('x'::bytea), 'acceptance');
  insert into party (id, party_type, code, name, created_by, updated_by)
    values ('00000000-0000-7000-8000-00000000a0d0', 'customer', 'C001', 'Bharat Steel', v_actor, v_actor);
  insert into document_series (id, registration_id, doc_type, series_code, series_nature,
                               fiscal_year_id, format, created_by)
    values ('00000000-0000-7000-8000-00000000a051', v_reg, 'sales_invoice', 'PLANT',
            'tax_invoice', v_fy, 'A/{FY}/{####}', v_actor);
end
$seed$;

-- ===========================================================================
-- A. NUMBERING (D2 / L8 / §3.6)
-- ===========================================================================
-- A1  Rule 46(b): a rendered number over 16 chars is refused at SERIES DESIGN TIME.
select erp.expect_error('A1 series format >16 chars refused at design time',
  $q$insert into document_series (id, registration_id, doc_type, series_code, series_nature,
        fiscal_year_id, format, created_by)
     values (gen_random_uuid(), '00000000-0000-7000-8000-00000000a0e0', 'sales_invoice',
             'LONG', 'tax_invoice', '00000000-0000-7000-8000-00000000a0f0',
             'VERYLONGPREFIX/{FY}/{#####}', '00000000-0000-7000-8000-000000000001')$q$,
  'ERP21');

-- A2  A format with no numeric token is refused.
select erp.expect_error('A2 series format without a numeric token refused',
  $q$insert into document_series (id, registration_id, doc_type, series_code, series_nature,
        fiscal_year_id, format, created_by)
     values (gen_random_uuid(), '00000000-0000-7000-8000-00000000a0e0', 'sales_invoice',
             'NOTOK', 'tax_invoice', '00000000-0000-7000-8000-00000000a0f0',
             'A/{FY}/X', '00000000-0000-7000-8000-000000000001')$q$,
  'ERP21');

-- A3  A declared external range must carry provenance (mid-year cut-over).
select erp.expect_error('A3 migrated range without a provenance note refused',
  $q$insert into document_series (id, registration_id, doc_type, series_code, series_nature,
        fiscal_year_id, format, start_ordinal, migrated_from, migrated_to, created_by)
     values (gen_random_uuid(), '00000000-0000-7000-8000-00000000a0e0', 'sales_invoice',
             'CUT', 'tax_invoice', '00000000-0000-7000-8000-00000000a0f0',
             'B/{FY}/{#####}', 843, 1, 842, '00000000-0000-7000-8000-000000000001')$q$,
  '23514');

-- A4  Allocation is monotonic and registers the number.
do $t$
declare r record;
begin
  select * into r from erp.allocate_doc_no('00000000-0000-7000-8000-00000000a051',
                                           '00000000-0000-7000-8000-00000000a0d1', '042025');
  if r.ordinal <> 1 or r.doc_no <> 'A/2025-26/0001' then
    raise exception 'FAIL A4: got % / %', r.ordinal, r.doc_no;
  end if;
  raise notice 'PASS  A4 first allocation is 1 -> %', r.doc_no;
end
$t$;

-- A5  A consumed number is NEVER released.
select erp.expect_error('A5 a consumed number cannot be deleted',
  $q$delete from document_number_register where ordinal = 1$q$, 'ERP23');

-- A6  Two documents cannot take the same number (the uniqueness half).
select erp.expect_error('A6 duplicate document number refused centrally',
  $q$insert into document_number_register (series_id, ordinal, registration_id, doc_type,
        series_nature, doc_no, document_id, issued_by)
     values ('00000000-0000-7000-8000-00000000a051', 99,
             '00000000-0000-7000-8000-00000000a0e0', 'sales_invoice', 'tax_invoice',
             'A/2025-26/0001', gen_random_uuid(), '00000000-0000-7000-8000-000000000001')$q$,
  '23505');

-- A7  The continuity auditor finds an existing hole and blocks IRN until acknowledged.
do $t$
declare n int;
begin
  update document_series set current = 5 where id = '00000000-0000-7000-8000-00000000a051';
  perform erp.detect_series_gaps('00000000-0000-7000-8000-00000000a051');
  select count(*) into n from series_gap where acknowledged_at is null;
  if n <> 1 then raise exception 'FAIL A7: expected 1 gap, got %', n; end if;
  raise notice 'PASS  A7 continuity auditor detected the 2-5 hole';
end
$t$;
select erp.expect_error('A7b unacknowledged gap blocks IRN and GSTR-1',
  $q$select erp.assert_series_clean('00000000-0000-7000-8000-00000000a0e0')$q$, 'ERP22');
do $t$
begin
  update series_gap set acknowledged_at = now(),
         acknowledged_by = '00000000-0000-7000-8000-000000000001',
         reason = 'restored from backup 2025-11-02, disclosed in Table 13';
  perform erp.assert_series_clean('00000000-0000-7000-8000-00000000a0e0');
  raise notice 'PASS  A7c acknowledgement unblocks, record kept';
end
$t$;
select erp.expect_error('A7d acknowledgement is permanent',
  $q$update series_gap set reason = 'changed my mind'$q$, 'ERP30');

-- ===========================================================================
-- B. DOCUMENT SPINE (D6 / D17 / §3.3)
-- ===========================================================================
do $t$
declare v_actor uuid := '00000000-0000-7000-8000-000000000001';
begin
  insert into sales_invoice (id, customer_id, place_of_supply, net_total, grand_total,
                             company_id, registration_id, document_date, posting_date,
                             created_by, updated_by)
    values ('00000000-0000-7000-8000-00000000a0d1',
            '00000000-0000-7000-8000-00000000a0d0', '27', 100, 100,
            '00000000-0000-7000-8000-00000000a0c0', '00000000-0000-7000-8000-00000000a0e0',
            '2025-05-01', '2025-05-01', v_actor, v_actor);
  raise notice 'PASS  B0 draft created without a number';
end
$t$;

-- B1  D17: a document may not bear a date AFTER the day it posts.
select erp.expect_error('B1 document_date > posting_date refused',
  $q$update sales_invoice set document_date = '2025-06-01' where id = '00000000-0000-7000-8000-00000000a0d1'$q$,
  '23514');

-- B2  A draft may not be numbered.
select erp.expect_error('B2 a draft cannot hold a document number',
  $q$insert into sales_invoice (id, customer_id, place_of_supply, net_total, grand_total,
        company_id, registration_id, document_date, posting_date, doc_no, doc_ordinal,
        created_by, updated_by)
     values (gen_random_uuid(), '00000000-0000-7000-8000-00000000a0d0', '27', 1, 1,
             '00000000-0000-7000-8000-00000000a0c0', '00000000-0000-7000-8000-00000000a0e0',
             '2025-05-01','2025-05-01','A/2025-26/0002', 2,
             '00000000-0000-7000-8000-000000000001','00000000-0000-7000-8000-000000000001')$q$,
  'ERP11');

-- B3  Submit: 0 -> 1 rewrites the spine legally.
do $t$
begin
  update sales_invoice
     set docstatus = 1, doc_no = 'A/2025-26/0001', doc_ordinal = 1,
         series_id = '00000000-0000-7000-8000-00000000a051',
         gst_report_period = '052025',
         ruleset_version_id = '00000000-0000-7000-8000-00000000a0f5',
         status = 'Unpaid'
   where id = '00000000-0000-7000-8000-00000000a0d1';
  raise notice 'PASS  B3 submit 0 -> 1 accepted';
end
$t$;

-- B4  THE CENTRAL INVARIANT: a submitted document is immutable outside the allowlist.
select erp.expect_error('B4 submitted document is immutable (net_total)',
  $q$update sales_invoice set net_total = 999 where id = '00000000-0000-7000-8000-00000000a0d1'$q$,
  'ERP10');
select erp.expect_error('B4b submitted document is immutable (place_of_supply)',
  $q$update sales_invoice set place_of_supply = '29' where id = '00000000-0000-7000-8000-00000000a0d1'$q$,
  'ERP10');

-- B5  ... but the derived status fields ARE writable, by the derivation service.
select erp.expect_ok('B5 allow_on_submit fields are writable',
  $q$update sales_invoice set status = 'Overdue', irn_status = 'pending'
      where id = '00000000-0000-7000-8000-00000000a0d1'$q$);

-- B6  submitted -> draft does not exist.
select erp.expect_error('B6 submitted -> draft does not exist',
  $q$update sales_invoice set docstatus = 0 where id = '00000000-0000-7000-8000-00000000a0d1'$q$,
  'ERP11');

-- B7  A submitted document is never deleted.
select erp.expect_error('B7 a submitted document cannot be deleted',
  $q$delete from sales_invoice where id = '00000000-0000-7000-8000-00000000a0d1'$q$, 'ERP12');

-- B8  Cancellation requires a reason.
select erp.expect_error('B8 cancellation without a reason refused',
  $q$update sales_invoice set docstatus = 2, cancelled_at = now(),
        cancelled_by = '00000000-0000-7000-8000-000000000001'
      where id = '00000000-0000-7000-8000-00000000a0d1'$q$, 'ERP61');

do $t$
begin
  update sales_invoice
     set docstatus = 2, cancelled_at = now(),
         cancelled_by = '00000000-0000-7000-8000-000000000001',
         cancel_reason = 'customer rejected the consignment', status = 'Cancelled'
   where id = '00000000-0000-7000-8000-00000000a0d1';
  raise notice 'PASS  B9 cancel 1 -> 2 accepted with a reason';
end
$t$;

-- B10 A cancelled document is frozen completely.
select erp.expect_error('B10 a cancelled document is frozen',
  $q$update sales_invoice set status = 'Reopened' where id = '00000000-0000-7000-8000-00000000a0d1'$q$,
  'ERP10');

-- B11 Amendment must originate from a CANCELLED document...
select erp.expect_error('B11 amended_from must be a cancelled document',
  $q$insert into sales_invoice (id, customer_id, place_of_supply, net_total, grand_total,
        company_id, registration_id, document_date, posting_date, amended_from, amend_seq,
        original_doc_no, original_doc_date, created_by, updated_by)
     values (gen_random_uuid(), '00000000-0000-7000-8000-00000000a0d0', '27', 1, 1,
             '00000000-0000-7000-8000-00000000a0c0','00000000-0000-7000-8000-00000000a0e0',
             '2025-05-01','2025-05-01', gen_random_uuid(), 1, 'X', '2025-05-01',
             '00000000-0000-7000-8000-000000000001','00000000-0000-7000-8000-000000000001')$q$,
  'ERP13');

-- B12 ... and it carries the original's identity for the GSTR-1 amendment table.
select erp.expect_error('B12 an amendment must carry original_doc_no/date',
  $q$insert into sales_invoice (id, customer_id, place_of_supply, net_total, grand_total,
        company_id, registration_id, document_date, posting_date, amended_from, amend_seq,
        created_by, updated_by)
     values (gen_random_uuid(), '00000000-0000-7000-8000-00000000a0d0', '27', 1, 1,
             '00000000-0000-7000-8000-00000000a0c0','00000000-0000-7000-8000-00000000a0e0',
             '2025-05-01','2025-05-01','00000000-0000-7000-8000-00000000a0d1', 1,
             '00000000-0000-7000-8000-000000000001','00000000-0000-7000-8000-000000000001')$q$,
  '23514');

select erp.expect_ok('B13 amendment from a cancelled document accepted',
  $q$insert into sales_invoice (id, customer_id, place_of_supply, net_total, grand_total,
        company_id, registration_id, document_date, posting_date, amended_from, amend_seq,
        original_doc_no, original_doc_date, created_by, updated_by)
     values ('00000000-0000-7000-8000-00000000a0d2',
             '00000000-0000-7000-8000-00000000a0d0', '27', 100, 100,
             '00000000-0000-7000-8000-00000000a0c0','00000000-0000-7000-8000-00000000a0e0',
             '2025-05-01','2025-05-01','00000000-0000-7000-8000-00000000a0d1', 1,
             'A/2025-26/0001','2025-05-01',
             '00000000-0000-7000-8000-000000000001','00000000-0000-7000-8000-000000000001')$q$);

-- ===========================================================================
-- C. GL (L1-L13 / D8)
-- ===========================================================================
-- C1  The balance assertion fires at COMMIT, not at insert.
do $t$
declare v uuid := gen_random_uuid();
begin
  begin
    insert into gl_entry (id, posting_date, document_date, voucher_type, voucher_id,
      account_id, cost_center_id, debit, credit, debit_ac_ccy, credit_ac_ccy,
      account_currency, exchange_rate, company_id, registration_id, fiscal_year_id,
      ruleset_version_id, created_by)
      values (gen_random_uuid(), '2025-05-01','2025-05-01','journal_entry', v,
              '00000000-0000-7000-8000-00000000a001','00000000-0000-7000-8000-00000000a0cc',
              100, 0, 100, 0, 'INR', 1,
              '00000000-0000-7000-8000-00000000a0c0','00000000-0000-7000-8000-00000000a0e0',
              '00000000-0000-7000-8000-00000000a0f0','00000000-0000-7000-8000-00000000a0f5',
              '00000000-0000-7000-8000-000000000001');
    -- force the deferred assertion to fire now
    perform erp.gl_flush_balance_assertions();
    raise exception 'FAIL C1: an unbalanced voucher committed';
  exception when sqlstate 'ERP40' or sqlstate 'ERP41' then
    raise notice 'PASS  C1 unbalanced/short voucher refused at the assertion boundary (%)', sqlstate;
  end;
end
$t$;

-- C2  A balanced two-leg voucher passes.
do $t$
declare v uuid := gen_random_uuid();
begin
  insert into gl_entry (id, posting_date, document_date, voucher_type, voucher_id,
    account_id, cost_center_id, debit, credit, debit_ac_ccy, credit_ac_ccy,
    account_currency, exchange_rate, company_id, registration_id, fiscal_year_id,
    ruleset_version_id, created_by)
    values (gen_random_uuid(), '2025-05-01','2025-05-01','journal_entry', v,
            '00000000-0000-7000-8000-00000000a001','00000000-0000-7000-8000-00000000a0cc',
            100, 0, 100, 0, 'INR', 1,
            '00000000-0000-7000-8000-00000000a0c0','00000000-0000-7000-8000-00000000a0e0',
            '00000000-0000-7000-8000-00000000a0f0','00000000-0000-7000-8000-00000000a0f5',
            '00000000-0000-7000-8000-000000000001'),
           (gen_random_uuid(), '2025-05-01','2025-05-01','journal_entry', v,
            '00000000-0000-7000-8000-00000000a002','00000000-0000-7000-8000-00000000a0cc',
            0, 100, 0, 100, 'INR', 1,
            '00000000-0000-7000-8000-00000000a0c0','00000000-0000-7000-8000-00000000a0e0',
            '00000000-0000-7000-8000-00000000a0f0','00000000-0000-7000-8000-00000000a0f5',
            '00000000-0000-7000-8000-000000000001');
  perform erp.gl_flush_balance_assertions();
  raise notice 'PASS  C2 balanced voucher accepted';
end
$t$;

-- C3  A GL row is never updated or deleted, by anyone.
select erp.expect_error('C3 gl_entry is append-only (UPDATE)',
  $q$update gl_entry set debit = 1 where debit = 100$q$, 'ERP30');
select erp.expect_error('C3b gl_entry is append-only (DELETE)',
  $q$delete from gl_entry$q$, 'ERP30');

-- C4  L5: no negative amounts, and one side only.
select erp.expect_error('C4 a negative debit is refused',
  $q$insert into gl_entry (id, posting_date, document_date, voucher_type, voucher_id,
       account_id, cost_center_id, debit, credit, debit_ac_ccy, credit_ac_ccy,
       account_currency, exchange_rate, company_id, registration_id, fiscal_year_id,
       ruleset_version_id, created_by)
     values (gen_random_uuid(),'2025-05-01','2025-05-01','journal_entry', gen_random_uuid(),
             '00000000-0000-7000-8000-00000000a001','00000000-0000-7000-8000-00000000a0cc',
             -1, 0, -1, 0, 'INR', 1,
             '00000000-0000-7000-8000-00000000a0c0','00000000-0000-7000-8000-00000000a0e0',
             '00000000-0000-7000-8000-00000000a0f0','00000000-0000-7000-8000-00000000a0f5',
             '00000000-0000-7000-8000-000000000001')$q$, '23514');

-- C5  D11: the dimensions key set is closed and empty in v1.
select erp.expect_error('C5 an unregistered dimension key is refused',
  $q$insert into gl_entry (id, posting_date, document_date, voucher_type, voucher_id,
       account_id, cost_center_id, debit, credit, debit_ac_ccy, credit_ac_ccy,
       account_currency, exchange_rate, company_id, registration_id, fiscal_year_id,
       ruleset_version_id, dimensions, created_by)
     values (gen_random_uuid(),'2025-05-01','2025-05-01','journal_entry', gen_random_uuid(),
             '00000000-0000-7000-8000-00000000a001','00000000-0000-7000-8000-00000000a0cc',
             1, 0, 1, 0, 'INR', 1,
             '00000000-0000-7000-8000-00000000a0c0','00000000-0000-7000-8000-00000000a0e0',
             '00000000-0000-7000-8000-00000000a0f0','00000000-0000-7000-8000-00000000a0f5',
             '{"project":"x"}', '00000000-0000-7000-8000-000000000001')$q$, 'ERP44');

-- ===========================================================================
-- D. PERIOD GATES (L7 / §3.4), in the stated precedence order
-- ===========================================================================
do $t$ begin
  update company_accounts_settings set accounts_frozen_till = '2025-06-30'
   where company_id = '00000000-0000-7000-8000-00000000a0c0';
end $t$;
select erp.expect_error('D1 accounts_frozen_till blocks a back-dated post (order 1)',
  $q$select erp.assert_period_open('00000000-0000-7000-8000-00000000a0c0',
        '00000000-0000-7000-8000-00000000a0e0','2025-05-01','052025','journal_entry')$q$,
  'ERP52');

do $t$ begin
  update company_accounts_settings set accounts_frozen_till = null
   where company_id = '00000000-0000-7000-8000-00000000a0c0';
  insert into gstr_log (id, registration_id, return_type, return_period, filing_status,
                        arn, filed_on, marked_by, marked_at, reason, created_by)
    values (gen_random_uuid(), '00000000-0000-7000-8000-00000000a0e0','gstr1','052025','filed',
            'AA2705250000001','2025-06-11','00000000-0000-7000-8000-000000000001', now(),
            'filed by CA, ARN attached', '00000000-0000-7000-8000-000000000001');
end $t$;
select erp.expect_error('D2 a filed return period blocks a post (order 2)',
  $q$select erp.assert_period_open('00000000-0000-7000-8000-00000000a0c0',
        '00000000-0000-7000-8000-00000000a0e0','2025-05-01','052025','journal_entry')$q$,
  'ERP53');

-- D3  Marking a period filed REQUIRES the ARN and the filing date as evidence.
select erp.expect_error('D3 filing without an ARN is refused',
  $q$insert into gstr_log (id, registration_id, return_type, return_period, filing_status, created_by)
     values (gen_random_uuid(),'00000000-0000-7000-8000-00000000a0e0','gstr3b','052025','filed',
             '00000000-0000-7000-8000-000000000001')$q$, '23514');

-- D4  Un-marking a filed period needs the supervisor role.
select erp.expect_error('D4 un-marking a filed period needs gst_supervisor',
  $q$update gstr_log set filing_status = 'open' where return_period = '052025'$q$, 'ERP53');

-- ===========================================================================
-- E. PARTY SUBLEDGER AND RECONCILIATION (A1 / A2)
-- ===========================================================================
do $t$
declare v_inv uuid := gen_random_uuid(); v_pay uuid := gen_random_uuid();
begin
  insert into payment_ledger_entry (id, posting_date, document_date, company_id, registration_id,
      party_type, party_id, account_id, voucher_type, voucher_id, amount, amount_ac_ccy,
      account_currency, due_date, installment_seq, ruleset_version_id, created_by)
    values (v_inv,'2025-05-01','2025-05-01','00000000-0000-7000-8000-00000000a0c0',
            '00000000-0000-7000-8000-00000000a0e0','customer',
            '00000000-0000-7000-8000-00000000a0d0','00000000-0000-7000-8000-00000000a001',
            'sales_invoice', gen_random_uuid(), 1000, 1000, 'INR','2025-05-31',1,
            '00000000-0000-7000-8000-00000000a0f5','00000000-0000-7000-8000-000000000001'),
           (v_pay,'2025-05-15','2025-05-15','00000000-0000-7000-8000-00000000a0c0',
            '00000000-0000-7000-8000-00000000a0e0','customer',
            '00000000-0000-7000-8000-00000000a0d0','00000000-0000-7000-8000-00000000a001',
            'payment_entry', gen_random_uuid(), -400, -400, 'INR', null, null,
            '00000000-0000-7000-8000-00000000a0f5','00000000-0000-7000-8000-000000000001');
  insert into reconciliation_edge (id, debit_ple_id, credit_ple_id, amount, created_by)
    values (gen_random_uuid(), v_inv, v_pay, 300, '00000000-0000-7000-8000-000000000001');
  if (select outstanding from v_ple_outstanding where ple_id = v_inv) <> 700 then
    raise exception 'FAIL E1: outstanding is %',
      (select outstanding from v_ple_outstanding where ple_id = v_inv);
  end if;
  raise notice 'PASS  E1 outstanding derived as 700 from an append-only subledger';

  begin
    insert into reconciliation_edge (id, debit_ple_id, credit_ple_id, amount, created_by)
      values (gen_random_uuid(), v_inv, v_pay, 50, '00000000-0000-7000-8000-000000000001');
    raise exception 'FAIL E2: duplicate edge accepted';
  exception when unique_violation then
    raise notice 'PASS  E2 one edge per (debit, credit) pair';
  end;
end
$t$;

-- E3  Two invoices cannot be reconciled against each other.
do $t$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
begin
  insert into payment_ledger_entry (id, posting_date, document_date, company_id, registration_id,
      party_type, party_id, account_id, voucher_type, voucher_id, amount, amount_ac_ccy,
      account_currency, ruleset_version_id, created_by)
    values (a,'2025-05-02','2025-05-02','00000000-0000-7000-8000-00000000a0c0',
            '00000000-0000-7000-8000-00000000a0e0','customer',
            '00000000-0000-7000-8000-00000000a0d0','00000000-0000-7000-8000-00000000a001',
            'sales_invoice', gen_random_uuid(), 50, 50, 'INR',
            '00000000-0000-7000-8000-00000000a0f5','00000000-0000-7000-8000-000000000001'),
           (b,'2025-05-03','2025-05-03','00000000-0000-7000-8000-00000000a0c0',
            '00000000-0000-7000-8000-00000000a0e0','customer',
            '00000000-0000-7000-8000-00000000a0d0','00000000-0000-7000-8000-00000000a001',
            'sales_invoice', gen_random_uuid(), 60, 60, 'INR',
            '00000000-0000-7000-8000-00000000a0f5','00000000-0000-7000-8000-000000000001');
  begin
    insert into reconciliation_edge (id, debit_ple_id, credit_ple_id, amount, created_by)
      values (gen_random_uuid(), a, b, 10, '00000000-0000-7000-8000-000000000001');
    raise exception 'FAIL E3: two invoices reconciled';
  exception when sqlstate 'ERP62' then
    raise notice 'PASS  E3 an edge joins one positive and one negative entry';
  end;
  begin
    insert into reconciliation_edge (id, debit_ple_id, credit_ple_id, amount, created_by)
      values (gen_random_uuid(), a,
              (select id from payment_ledger_entry where amount = -400), 500,
              '00000000-0000-7000-8000-000000000001');
    raise exception 'FAIL E4: over-allocation accepted';
  exception when sqlstate 'ERP60' then
    raise notice 'PASS  E4 over-allocation refused';
  end;
end
$t$;

-- E5  The PLE itself is append-only.
select erp.expect_error('E5 payment_ledger_entry is append-only',
  $q$update payment_ledger_entry set amount = 1$q$, 'ERP30');

-- E6  Unreconciliation requires the named role AND a reason.
select erp.expect_error('E6 unreconcile without the reconciler role refused',
  $q$delete from reconciliation_edge$q$, 'ERP61');

-- ===========================================================================
-- F. RULE STORE (L10 / D9)
-- ===========================================================================
do $t$ begin
  insert into statutory_rule (id, domain, key, jurisdiction, effective_from, effective_to,
      payload, notification_ref, verified_by, verified_on, created_by)
    values (gen_random_uuid(),'gst','gst.rate.hsn.7318','IN','2017-07-01','2025-09-22',
            '{"rate":18}','N-01/2017-CT','CA A. Rao','2025-10-01',
            '00000000-0000-7000-8000-000000000001'),
           (gen_random_uuid(),'gst','gst.rate.hsn.7318','IN','2025-09-22', null,
            '{"rate":18}','56th GST Council','CA A. Rao','2025-10-01',
            '00000000-0000-7000-8000-000000000001');
  raise notice 'PASS  F1 two non-overlapping validity windows accepted';
end $t$;

select erp.expect_error('F2 overlapping validity is a DATABASE error',
  $q$insert into statutory_rule (id, domain, key, jurisdiction, effective_from, effective_to,
       payload, notification_ref, verified_by, verified_on, created_by)
     values (gen_random_uuid(),'gst','gst.rate.hsn.7318','IN','2020-01-01','2021-01-01',
             '{"rate":12}','X','Y','2025-10-01','00000000-0000-7000-8000-000000000001')$q$,
  '23P01');

select erp.expect_error('F3 resolve() throws on a missing rule, never returns zero',
  $q$select erp.resolve_rule('gst.rate.hsn.9999','IN','2025-05-01')$q$, 'ERP01');

do $t$
declare r statutory_rule;
begin
  r := erp.resolve_rule('gst.rate.hsn.7318','IN','2025-09-30');
  if r.effective_from <> '2025-09-22' then
    raise exception 'FAIL F4: resolved the wrong window (%)', r.effective_from;
  end if;
  raise notice 'PASS  F4 resolve() picks the window in force on the date';
end $t$;

select erp.expect_error('F5 a statutory rule can never be edited',
  $q$update statutory_rule set payload = '{"rate":5}' where key = 'gst.rate.hsn.7318'$q$, 'ERP30');

-- ===========================================================================
-- G. AUDIT (D1 / L9 / §3.5)
-- ===========================================================================
do $t$
declare s1 bigint; s2 bigint; n int;
begin
  s1 := erp.audit_write(gen_random_uuid(), 'sales_invoice',
          '00000000-0000-7000-8000-00000000a0d1','sales_invoice',
          '00000000-0000-7000-8000-00000000a0d1','insert',
          '00000000-0000-7000-8000-00000000a0c0', null, '{"net_total":100}');
  s2 := erp.audit_write(gen_random_uuid(), 'sales_invoice',
          '00000000-0000-7000-8000-00000000a0d1','sales_invoice',
          '00000000-0000-7000-8000-00000000a0d1','update',
          '00000000-0000-7000-8000-00000000a0c0', '{"net_total":100}', '{"net_total":120}');
  if s2 <> s1 + 1 then raise exception 'FAIL G1: chain_seq not contiguous'; end if;
  select count(*) into n from erp.audit_verify();
  if n <> 0 then raise exception 'FAIL G2: audit_verify reported % break(s)', n; end if;
  if (select changed_fields from audit_log where chain_seq = s2) <> array['net_total'] then
    raise exception 'FAIL G3: field-level delta not computed';
  end if;
  raise notice 'PASS  G1-G3 chain contiguous, verifies, field-level delta computed';
end $t$;

select erp.expect_error('G4 audit_log is append-only (UPDATE)',
  $q$update audit_log set reason = 'tampered'$q$, 'ERP30');
select erp.expect_error('G5 audit_log is append-only (DELETE)',
  $q$delete from audit_log$q$, 'ERP30');
select erp.expect_error('G6 cancel/amend/config_change require a reason',
  $q$insert into audit_log (occurred_at, tenant_id, event_id, root_entity, root_entity_id,
       entity, entity_id, action, actor_user_id, actor_roles, request_id, app_version,
       company_id, chain_seq, prev_hash, row_hash)
     values (now(), erp.this_tenant(), gen_random_uuid(),'x',gen_random_uuid(),'x',
             gen_random_uuid(),'cancel','00000000-0000-7000-8000-000000000001','{}','r','v',
             '00000000-0000-7000-8000-00000000a0c0', 999, '\x00','\x00')$q$, '23514');

-- G7  Tamper detection: break the chain and prove audit_verify catches it.
do $t$
declare n int;
begin
  alter table audit_chain_link disable trigger audit_chain_link_append_only;
  update audit_chain_link set prev_hash = '\xdeadbeef'
   where chain_seq = (select max(chain_seq) from audit_chain_link);
  alter table audit_chain_link enable trigger audit_chain_link_append_only;
  select count(*) into n from erp.audit_verify();
  if n = 0 then raise exception 'FAIL G7: tampering not detected'; end if;
  raise notice 'PASS  G7 audit_verify detects a broken chain (% break(s))', n;
end $t$;

-- ===========================================================================
-- H. TAX (T5 / T7 / T8 / T10)
-- ===========================================================================
insert into tax_template (id, company_id, code, name, doc_direction, created_by)
  values ('00000000-0000-7000-8000-00000000a0f1','00000000-0000-7000-8000-00000000a0c0',
          'OUT18','Output 18%','sales','00000000-0000-7000-8000-000000000001');

select erp.expect_error('H1 a GST head may not sit on "On Previous Row Amount" (T4 v4)',
  $q$insert into tax_template_row (id, template_id, sequence, charge_type, previous_row_seq,
       rate, account_id, tax_character)
     values (gen_random_uuid(),'00000000-0000-7000-8000-00000000a0f1',1,
             'on_previous_row_amount', null, 9,
             '00000000-0000-7000-8000-00000000a002','cgst')$q$, '23514');

select erp.expect_error('H2 "On Item Quantity" is only for cess_non_advol (T4 v5)',
  $q$insert into tax_template_row (id, template_id, sequence, charge_type, rate, account_id,
       tax_character)
     values (gen_random_uuid(),'00000000-0000-7000-8000-00000000a0f1',2,'on_item_quantity',
             5,'00000000-0000-7000-8000-00000000a002','igst')$q$, '23514');

do $t$ begin
  insert into tax_template_row (id, template_id, sequence, charge_type, rate, account_id,
      tax_character)
    values ('00000000-0000-7000-8000-00000000a0f7','00000000-0000-7000-8000-00000000a0f1',
            3,'on_net_total',9,'00000000-0000-7000-8000-00000000a002','cgst');
  raise notice 'PASS  H3 a normal ad-valorem GST row is accepted';
end $t$;

-- H4  T7: repartition lists must be equal length and sum to +100.
do $t$ begin
  begin
    insert into tax_repartition_line (id, template_row_id, kind, ordinal, factor, account_id)
      values (gen_random_uuid(),'00000000-0000-7000-8000-00000000a0f7','invoice',1,100,
              '00000000-0000-7000-8000-00000000a002');
    -- no matching refund line: the deferred assertion must fire at flush
    set constraints repartition_balanced immediate;
    raise exception 'FAIL H4: unbalanced repartition accepted';
  exception when sqlstate 'ERP72' then
    raise notice 'PASS  H4 repartition lists must be equal length';
  end;
end $t$;

-- H5  T10: 5- and 7-digit HSN codes do not exist.
select erp.expect_error('H5 a 5-digit HSN code is refused',
  $q$insert into sales_invoice_line (id, invoice_id, line_no, description, hsn_code, qty, uom,
       rate, net_amount, gst_treatment, cost_center_id)
     values (gen_random_uuid(),'00000000-0000-7000-8000-00000000a0d2',1,'MS Angle','73181',
             1,'KGS',100,100,'taxable','00000000-0000-7000-8000-00000000a0cc')$q$, '23514');

-- ===========================================================================
-- I. OVERLAY (D11 / §3.2)
-- ===========================================================================
do $t$ begin
  insert into registry_build (id, built_at, git_sha, digest, is_current)
    values ('00000000-0000-7000-8000-00000000a0b1', now(),'abc123', sha256('r'::bytea), true);
  insert into registry_field (build_id, entity, field_name, data_type, is_statutory)
    values ('00000000-0000-7000-8000-00000000a0b1','sales_invoice','doc_no','text',true),
           ('00000000-0000-7000-8000-00000000a0b1','sales_invoice','net_total','numeric',true),
           ('00000000-0000-7000-8000-00000000a0b1','sales_invoice','remarks','text',false);
end $t$;

select erp.expect_error('I1 an extension field may not shadow a base field',
  $q$insert into field_extension (id, tenant_id, entity, field_key, data_type, label, created_by)
     values (gen_random_uuid(), erp.this_tenant(),'sales_invoice','net_total','numeric','X',
             '00000000-0000-7000-8000-000000000001')$q$, 'ERP70');

select erp.expect_ok('I2 a genuinely new extension field is accepted',
  $q$insert into field_extension (id, tenant_id, entity, field_key, data_type, label, created_by)
     values (gen_random_uuid(), erp.this_tenant(),'sales_invoice','buyer_po_no','text',
             'Buyer PO No','00000000-0000-7000-8000-000000000001')$q$);

do $t$
declare v bigint;
begin
  select version into v from overlay_version;
  if v is null then raise exception 'FAIL I3: overlay_version was not bumped'; end if;
  raise notice 'PASS  I3 overlay_version bumped by the extension write (v=%)', v;
end $t$;

do $t$ begin
  insert into overridable_property (property, applies_to, value_type)
    values ('label','field','text'), ('reqd','field','boolean');
end $t$;
select erp.expect_error('I4 a statutory field may not be overridden',
  $q$insert into property_override (id, entity, field, property, layer, value, created_by, updated_by)
     values (gen_random_uuid(),'sales_invoice','doc_no','label','tenant','"Bill No"',
             '00000000-0000-7000-8000-000000000001','00000000-0000-7000-8000-000000000001')$q$,
  'ERP71');
select erp.expect_ok('I5 a non-statutory field may be relabelled per layer',
  $q$insert into property_override (id, entity, field, property, layer, value, created_by, updated_by)
     values (gen_random_uuid(),'sales_invoice','remarks','label','tenant','"Notes"',
             '00000000-0000-7000-8000-000000000001','00000000-0000-7000-8000-000000000001')$q$);

-- ===========================================================================
select 'ALL ACCEPTANCE CHECKS PASSED' as result;

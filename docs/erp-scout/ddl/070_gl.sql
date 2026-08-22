-- ============================================================================
-- 070_gl.sql   §3.4 / L1-L13 / D8.  The general ledger.
--
-- INSERT-only.  The application role has no UPDATE/DELETE grant, and a trigger
-- refuses both for everyone including the owner.  Cancel is a mirrored
-- reversing set with reverses_entry_id, posting_date = today, voucher_id
-- unchanged.  "Is this reversed?" is DERIVED (EXISTS ... WHERE reverses_entry_id
-- = e.id), never a stored flag - because UPDATE on posted rows is forbidden.
--
-- seq is THE total order.  Ordering is always (posting_date, seq), never
-- (posting_datetime, creation) with tiebreak heuristics.
--
-- The accounting facet lives here; the commercial facet (item, qty, rate,
-- discount) lives on the document's line table, joined by voucher_line_id.
-- Merging them is how account_move.py reached 7,456 lines.
-- ============================================================================
\set ON_ERROR_STOP on

-- D11: "one analytic axis, not N".  The analytic axis is cost_center_id.  The
-- dimensions column exists ONLY so that a second axis arrives as a
-- registry-declared key plus a promoted generated column rather than a ledger
-- migration.  ONLY THE MIGRATOR MAY REGISTER A KEY, and the table is EMPTY in v1.
create table gl_dimension_key (
  key         text primary key,
  label       text not null,
  value_type  text not null check (value_type in ('uuid','text','int')),
  registered_at timestamptz not null default now(),
  registered_by uuid not null
);

create table gl_entry (
  id                uuid primary key,
  -- THE total order.  bigint identity allocates on REQUEST, not on commit, so
  -- rows commit out of seq order - see erp.safe_watermark_xmin() and txid below.
  seq               bigint generated always as identity unique,
  txid              xid8 not null default pg_current_xact_id(),  -- the watermark rule (§3.4)
  tenant_id         uuid not null default erp.this_tenant(),

  posting_date      date not null,     -- the ledger date; the four period gates test THIS
  document_date     date not null,     -- the date the source document BEARS (D17)
  gst_report_period erp.gst_period,    -- the return period, stamped at post time (D17)

  voucher_type      text not null,
  voucher_id        uuid not null,
  voucher_line_id   uuid,

  account_id        uuid not null references account(id),
  party_id          uuid references party(id),
  -- D10 / §4.1B: NOT NULL.  A single nullable scoping column reintroduces the
  -- blank-means-allow footgun the whole NOT NULL set exists to delete.  Every
  -- company gets a default cost centre at setup so this is satisfiable on day one.
  cost_center_id    uuid not null references cost_center(id),

  debit             erp.amount not null default 0,
  credit            erp.amount not null default 0,
  -- L6: four amount legs, STORED, never reconverted at report time.
  debit_ac_ccy      erp.amount not null default 0,
  credit_ac_ccy     erp.amount not null default 0,
  account_currency  char(3) not null,
  exchange_rate     erp.fx not null,

  company_id        uuid not null references company(id),
  registration_id   uuid not null references gstin_registration(id),
  fiscal_year_id    uuid not null references fiscal_year(id),

  dimensions        jsonb not null default '{}',   -- CLOSED key set, EMPTY in v1

  reverses_entry_id uuid references gl_entry(id),
  ruleset_version_id uuid not null references ruleset_version(id),   -- D9: the ruleset, not a rule
  is_opening        boolean not null default false,
  is_migration      boolean not null default false,   -- L11: the only writer is the migrator
  -- §3.4: a branch transfer is a real invoice with real GL on both sides,
  -- excluded by an EXPLICIT report rule from consolidated revenue, consolidated
  -- COGS and aggregate turnover - not by a filter someone remembers to apply.
  is_internal_supply boolean not null default false,
  created_at        timestamptz not null default now(),
  created_by        uuid not null,

  constraint gl_no_negative_amounts check (debit >= 0 and credit >= 0),     -- L5
  constraint gl_one_side_only       check (debit * credit = 0),             -- L5 / Odoo's CHECK
  constraint gl_ac_ccy_no_negative  check (debit_ac_ccy >= 0 and credit_ac_ccy >= 0),
  constraint gl_ac_ccy_one_side     check (debit_ac_ccy * credit_ac_ccy = 0),
  -- The two legs must agree about which side they are on.
  constraint gl_sides_agree
    check ((debit > 0) = (debit_ac_ccy > 0) or (debit = 0 and debit_ac_ccy = 0)),
  constraint gl_fx_positive         check (exchange_rate > 0),
  constraint gl_date_order          check (document_date <= posting_date),  -- D17
  constraint gl_zero_row_dropped    check (debit <> 0 or credit <> 0)       -- §3.4 step 5
);

create index gl_account_posting_ix on gl_entry (account_id, posting_date, seq);
create index gl_voucher_ix         on gl_entry (voucher_type, voucher_id);
create index gl_party_ix           on gl_entry (party_id, posting_date, seq) where party_id is not null;
create index gl_period_ix          on gl_entry (company_id, fiscal_year_id, posting_date);
create index gl_gstr_ix            on gl_entry (registration_id, gst_report_period)
  where gst_report_period is not null;
-- §3.4 defect (ii): without this, a double-cancel race writes TWO reversals
-- against one entry and the ledger balances while the account is wrong.
create unique index gl_reverses_uq on gl_entry (reverses_entry_id)
  where reverses_entry_id is not null;

select erp.make_append_only('public', 'gl_entry');

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: the guards that must hold per row.
-- Step 2 (period gates), step 3 (disabled/group account), and the closed
-- dimension key set.  The service layer runs these first for fast feedback;
-- this trigger is the guarantee.
-- ---------------------------------------------------------------------------
create or replace function erp.tg_gl_entry_guard() returns trigger
  language plpgsql as
$fn$
declare a account%rowtype; cc cost_center%rowtype; k text;
begin
  -- step 3
  select * into a from account where id = new.account_id;
  if a.is_group then
    raise exception 'account % is a group account and cannot be posted to', a.code
      using errcode = 'ERP42';
  end if;
  if a.is_disabled then
    raise exception 'account % is disabled', a.code using errcode = 'ERP42';
  end if;
  if a.company_id <> new.company_id then
    raise exception 'account % belongs to another company', a.code using errcode = 'ERP43';
  end if;
  if a.account_currency <> new.account_currency then
    raise exception 'account % is denominated in %, not %', a.code, a.account_currency,
      new.account_currency using errcode = 'ERP42';
  end if;

  select * into cc from cost_center where id = new.cost_center_id;
  if cc.is_group or cc.is_disabled then
    raise exception 'cost centre % is a group or is disabled', cc.code using errcode = 'ERP42';
  end if;
  if cc.company_id <> new.company_id then
    raise exception 'cost centre % belongs to another company', cc.code using errcode = 'ERP43';
  end if;

  -- D11: the dimensions key set is closed.  Empty registry in v1 means an
  -- empty object is the only legal value, and that is deliberate.
  for k in select jsonb_object_keys(new.dimensions) loop
    if not exists (select 1 from gl_dimension_key where key = k) then
      raise exception 'dimension key % is not registered', k using errcode = 'ERP44';
    end if;
  end loop;

  -- step 2, in the stated precedence order, first refusal wins.
  perform erp.assert_period_open(new.company_id, new.registration_id,
                                 new.posting_date, new.gst_report_period, new.voucher_type);

  -- L11: only the migrator may stamp is_migration.
  if new.is_migration and erp.posting_mode() <> 'migration' then
    raise exception 'is_migration may be set only in migration mode' using errcode = 'ERP61';
  end if;

  -- L2: a reversal points at a real, non-reversal entry of the same voucher.
  if new.reverses_entry_id is not null then
    if not exists (select 1 from gl_entry g
                    where g.id = new.reverses_entry_id
                      and g.reverses_entry_id is null) then
      raise exception 'reverses_entry_id must reference an original (non-reversing) entry'
        using errcode = 'ERP40';
    end if;
  end if;
  return new;
end
$fn$;
create trigger gl_entry_guard before insert on gl_entry
  for each row execute function erp.tg_gl_entry_guard();

-- ---------------------------------------------------------------------------
-- THE BALANCE ASSERTION.  Authoritative in the database; the application check
-- is fast feedback, not the guarantee.
--
-- Postgres CREATE CONSTRAINT TRIGGER supports only FOR EACH ROW - a
-- statement-level constraint trigger with a transition table does not exist -
-- so a 6-leg voucher would run the balancing aggregate six times and a ~1000-row
-- import batch would run thousands of aggregate scans at COMMIT.  The function
-- therefore DEDUPES BY voucher_id in a transaction-local set and performs ONE
-- aggregate per voucher per transaction.  This is a correctness-neutral,
-- MANDATORY optimisation and it belongs in the same migration as the trigger.
--
-- The set is a temp table with ON COMMIT DELETE ROWS: created once per server
-- connection (safe under PgBouncer transaction pooling, because the CONTENTS -
-- not the table - are what is transaction-scoped), and cleared at every commit.
--
-- Tolerance in the database is ZERO.  The precision-derived tolerance and the
-- round-off line belong to §3.4 step 7, which runs BEFORE the insert.  A
-- database that accepts "nearly balanced" is a database that has no invariant.
-- ---------------------------------------------------------------------------
create or replace function erp.assert_voucher_balanced() returns trigger
  language plpgsql as
$fn$
declare
  n_lines int; d erp.amount; c erp.amount; n_co int; fresh boolean;
begin
  if to_regclass('pg_temp.erp_balanced_vouchers') is null then
    create temp table erp_balanced_vouchers (voucher_id uuid primary key) on commit delete rows;
  end if;

  execute 'insert into pg_temp.erp_balanced_vouchers (voucher_id) values ($1)
           on conflict do nothing returning true'
    into fresh using new.voucher_id;
  if fresh is not true then
    return null;                       -- already asserted for this voucher in this transaction
  end if;

  select count(*), sum(debit), sum(credit), count(distinct company_id)
    into n_lines, d, c, n_co
    from gl_entry where voucher_id = new.voucher_id;

  if n_lines < 2 then                                                     -- §3.4 step 8
    raise exception 'voucher % has % GL line(s); a voucher needs at least two',
      new.voucher_id, n_lines using errcode = 'ERP41';
  end if;
  if n_co > 1 then                                                        -- one voucher, one company
    raise exception 'voucher % spans % companies', new.voucher_id, n_co using errcode = 'ERP43';
  end if;
  if d <> c then                                                          -- L3
    raise exception 'voucher % is unbalanced: debit % vs credit % (difference %)',
      new.voucher_id, d, c, d - c
      using errcode = 'ERP40',
            hint = 'Round-off is applied before insert (§3.4 step 7). The database tolerance is zero.';
  end if;
  return null;
end
$fn$;

create constraint trigger gl_voucher_balanced
  after insert on gl_entry
  deferrable initially deferred
  for each row execute function erp.assert_voucher_balanced();

-- ---------------------------------------------------------------------------
-- The importer reconciliation, which the plan left in conflict.
-- A deferred constraint trigger fires at COMMIT, NOT at savepoint release - so
-- §3.8's "batches of ~1000 with a savepoint per batch" would detect an
-- imbalanced batch only at the end of the whole transaction and roll back every
-- earlier batch, defeating the savepoint entirely.  The importer calls this at
-- the end of each batch so the assertion boundary and the savepoint boundary
-- coincide and a bad batch fails alone.
--
-- The DELETE is not optional: without it, a voucher whose rows are split across
-- two batches would be marked "already asserted" and the second half would go
-- unchecked.
-- ---------------------------------------------------------------------------
create or replace function erp.gl_flush_balance_assertions() returns void
  language plpgsql as
$fn$
begin
  set constraints gl_voucher_balanced immediate;
  if to_regclass('pg_temp.erp_balanced_vouchers') is not null then
    execute 'delete from pg_temp.erp_balanced_vouchers';
  end if;
  set constraints gl_voucher_balanced deferred;
end
$fn$;

-- ---------------------------------------------------------------------------
-- Third layer: the nightly auditor.  Sums the ledger per (company, FY) and
-- ALARMS on drift - alarm, not silent repair.
-- ---------------------------------------------------------------------------
create view v_gl_drift as
  select company_id, fiscal_year_id,
         sum(debit) as total_debit, sum(credit) as total_credit,
         sum(debit) - sum(credit) as drift
    from gl_entry
   group by company_id, fiscal_year_id
  having sum(debit) <> sum(credit);

-- L2: "is this reversed?" is derived, never stored.
create view v_gl_entry_reversal as
  select g.id,
         exists (select 1 from gl_entry r where r.reverses_entry_id = g.id) as is_reversed
    from gl_entry g;

-- ---------------------------------------------------------------------------
-- Cached read models.  Permitted ONLY if (1) rebuildable by one command,
-- (2) stamped with a SAFE WATERMARK, (3) NEVER read by any posting-path
-- validation.  Property (3) is why this table has no trigger and no FK from
-- anything in the posting path.
-- ---------------------------------------------------------------------------
create table account_period_balance (
  company_id     uuid not null references company(id),
  account_id     uuid not null references account(id),
  cost_center_id uuid not null references cost_center(id),
  fiscal_year_id uuid not null references fiscal_year(id),
  period_month   date not null,
  debit          erp.amount not null,
  credit         erp.amount not null,
  built_txid_below xid8 not null,        -- the watermark, not max(seq)
  built_at       timestamptz not null default now(),
  primary key (company_id, account_id, cost_center_id, period_month)
);

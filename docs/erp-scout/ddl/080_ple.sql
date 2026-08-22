-- ============================================================================
-- 080_ple.sql   §3.4 / A1 / A2 / A5.  The party subledger - the third ledger.
--
-- A1: outstanding is DERIVED by recomputation over an append-only SIGNED
-- subledger.  Never incremented, never stored on the invoice.  Both CTEs below
-- are written ONCE and every report and every screen calls them - A1's failure
-- mode is two implementations that disagree, not one that is wrong.
--
-- A2: partial reconciliation IS AN EDGE.  A connected component reaching zero is
-- a full reconcile.  Unreconciliation is DELETE on the edge - the one
-- deliberate exception to append-only in this schema, because the edge is a
-- LINK, not a posting, so deleting it moves no money.  The alternative
-- (ERPNext's) re-opens the submitted payment and rebuilds the PLE, which is
-- mutating a submitted document.
--
-- SIGN CONVENTION, which the plan leaves implicit and which every query below
-- depends on: amount is SIGNED, in company currency, from the PARTY ACCOUNT'S
-- point of view.  A sales invoice debits the receivable, so it is POSITIVE.  A
-- receipt credits it, so it is NEGATIVE.  Purchase invoices are NEGATIVE and
-- payments POSITIVE on the payable side.  See OPEN ITEM O-5.
-- ============================================================================
\set ON_ERROR_STOP on

create table payment_ledger_entry (
  id                uuid primary key,
  seq               bigint generated always as identity unique,     -- ordering, as in gl_entry
  txid              xid8 not null default pg_current_xact_id(),
  tenant_id         uuid not null default erp.this_tenant(),

  posting_date      date not null,
  document_date     date not null,      -- D17: ageing and interest read THIS, never posting_date
  company_id        uuid not null references company(id),
  registration_id   uuid not null references gstin_registration(id),

  party_type        erp.party_type not null,
  party_id          uuid not null,
  account_id        uuid not null references account(id),

  voucher_type      text not null,
  voucher_id        uuid not null,
  voucher_line_id   uuid,
  against_voucher_type text,
  against_voucher_id   uuid,            -- null on the invoice leg

  amount            erp.amount not null,      -- SIGNED, company currency
  amount_ac_ccy     erp.amount not null,      -- SIGNED, account currency
  account_currency  char(3) not null,

  due_date          date,                     -- A3/A4 read these
  installment_seq   smallint,
  ruleset_version_id uuid not null references ruleset_version(id),
  is_opening        boolean not null default false,   -- L11 path 1: open items at INVOICE level
  created_at        timestamptz not null default now(),
  created_by        uuid not null,

  -- Real FK, not Dynamic Link polymorphism (§3.2).  This is the composite-key
  -- form the party supertype's (id, party_type) unique constraint exists for.
  constraint ple_party_fk foreign key (party_id, party_type)
    references party (id, party_type),
  constraint ple_no_zero_amount check (amount <> 0),
  constraint ple_signs_agree    check (sign(amount) = sign(amount_ac_ccy)),
  constraint ple_date_order     check (document_date <= posting_date),
  constraint ple_against_pair
    check ((against_voucher_type is null) = (against_voucher_id is null)),
  constraint ple_installment_has_due
    check (installment_seq is null or due_date is not null)
);

create index ple_party_ix on payment_ledger_entry
  (party_type, party_id, account_id, posting_date, seq);
create index ple_voucher_ix on payment_ledger_entry (voucher_type, voucher_id);
create index ple_against_ix on payment_ledger_entry (against_voucher_type, against_voucher_id)
  where against_voucher_id is not null;
create index ple_due_ix on payment_ledger_entry (company_id, due_date)
  where due_date is not null;

select erp.make_append_only('public', 'payment_ledger_entry');

-- ---------------------------------------------------------------------------
-- reconciliation_edge   A2.
-- ---------------------------------------------------------------------------
create table reconciliation_edge (
  id            uuid primary key,
  tenant_id     uuid not null default erp.this_tenant(),
  debit_ple_id  uuid not null references payment_ledger_entry(id),
  credit_ple_id uuid not null references payment_ledger_entry(id),
  amount        erp.amount not null check (amount > 0),   -- company currency
  created_at    timestamptz not null default now(),
  created_by    uuid not null,
  constraint reconciliation_edge_uq unique (debit_ple_id, credit_ple_id),
  constraint reconciliation_edge_distinct check (debit_ple_id <> credit_ple_id)
);
create index reconciliation_edge_credit_ix on reconciliation_edge (credit_ple_id);

-- The four things an edge must satisfy that no FK can express:
--   1. one positive and one negative PLE (you cannot reconcile two invoices),
--   2. the same company, party and account (an edge is not a transfer),
--   3. neither endpoint over-allocated,
--   4. serialisation, so two concurrent reconciliations cannot both pass (3).
create or replace function erp.tg_reconciliation_edge_guard() returns trigger
  language plpgsql as
$fn$
declare d payment_ledger_entry%rowtype; c payment_ledger_entry%rowtype; used erp.amount;
begin
  -- 4: lock both endpoints in sorted key order so two documents touching the
  -- same pair cannot deadlock.  Same idiom as the D13 stock lock.
  perform pg_advisory_xact_lock(hashtextextended(k::text, 0))
     from (select least(new.debit_ple_id, new.credit_ple_id) as k
           union all
           select greatest(new.debit_ple_id, new.credit_ple_id)) s(k)
    order by k;

  select * into d from payment_ledger_entry where id = new.debit_ple_id;
  select * into c from payment_ledger_entry where id = new.credit_ple_id;

  if not (d.amount > 0 and c.amount < 0) then                                   -- 1
    raise exception 'a reconciliation edge joins one positive and one negative entry (got %, %)',
      d.amount, c.amount using errcode = 'ERP62';
  end if;
  if d.company_id <> c.company_id or d.party_id <> c.party_id
     or d.party_type <> c.party_type or d.account_id <> c.account_id then       -- 2
    raise exception 'a reconciliation edge joins one company, party and account'
      using errcode = 'ERP63';
  end if;

  select coalesce(sum(amount), 0) into used from reconciliation_edge
   where debit_ple_id = new.debit_ple_id and id <> new.id;                      -- 3
  if used + new.amount > abs(d.amount) then
    raise exception 'over-allocation on entry %: % already allocated of %, cannot add %',
      d.id, used, abs(d.amount), new.amount using errcode = 'ERP60';
  end if;
  select coalesce(sum(amount), 0) into used from reconciliation_edge
   where credit_ple_id = new.credit_ple_id and id <> new.id;
  if used + new.amount > abs(c.amount) then
    raise exception 'over-allocation on entry %: % already allocated of %, cannot add %',
      c.id, used, abs(c.amount), new.amount using errcode = 'ERP60';
  end if;
  return new;
end
$fn$;
create trigger reconciliation_edge_guard before insert or update on reconciliation_edge
  for each row execute function erp.tg_reconciliation_edge_guard();

-- Unreconciliation: DELETE, by a NAMED role, audited, with a reason.
-- UPDATE is forbidden outright - an edge is created or removed, never edited.
create or replace function erp.tg_reconciliation_edge_delete() returns trigger
  language plpgsql as
$fn$
begin
  if not erp.has_role('reconciler') then
    raise exception 'unreconciliation requires the reconciler role' using errcode = 'ERP61';
  end if;
  if nullif(btrim(coalesce(erp.ctx('unreconcile_reason', false), '')), '') is null then
    raise exception 'unreconciliation requires a reason (set erp.unreconcile_reason)'
      using errcode = 'ERP61';
  end if;
  perform erp.audit_write(
    nullif(erp.ctx('event_id', false), '')::uuid,
    'payment_ledger_entry', old.debit_ple_id,
    'reconciliation_edge', old.id, 'unreconcile',
    (select company_id from payment_ledger_entry where id = old.debit_ple_id),
    to_jsonb(old), null, null, erp.ctx('unreconcile_reason'));
  return old;
end
$fn$;
create trigger reconciliation_edge_delete before delete on reconciliation_edge
  for each row execute function erp.tg_reconciliation_edge_delete();
revoke update on reconciliation_edge from erp_app;

-- ---------------------------------------------------------------------------
-- THE TWO CANONICAL CTEs.  Written once, in packages/ledger, mirrored here as
-- views so that a report, a screen and a raw query cannot disagree.
-- ---------------------------------------------------------------------------

-- A1: outstanding per voucher = signed amount, minus the edges touching it.
create view v_ple_outstanding as
  with allocated as (
    select debit_ple_id as ple_id, sum(amount) as alloc from reconciliation_edge group by 1
    union all
    select credit_ple_id, sum(amount) from reconciliation_edge group by 1
  )
  select p.id                         as ple_id,
         p.company_id, p.registration_id,
         p.party_type, p.party_id, p.account_id,
         p.voucher_type, p.voucher_id, p.voucher_line_id,
         p.document_date, p.posting_date, p.due_date, p.installment_seq,
         p.amount,
         coalesce(a.alloc, 0)                             as allocated,
         sign(p.amount) * (abs(p.amount) - coalesce(a.alloc, 0)) as outstanding
    from payment_ledger_entry p
    left join (select ple_id, sum(alloc) as alloc from allocated group by 1) a
      on a.ple_id = p.id;

-- A1 rolled up per voucher; A4: overdue is per INSTALMENT, not merely "the
-- final due date passed", so the grain here is (voucher, installment_seq).
create view v_party_outstanding as
  select company_id, registration_id, party_type, party_id, account_id,
         voucher_type, voucher_id, installment_seq,
         min(document_date) as document_date,
         min(due_date)      as due_date,
         sum(amount)        as gross,
         sum(outstanding)   as outstanding
    from v_ple_outstanding
   group by 1,2,3,4,5,6,7,8
  having sum(outstanding) <> 0;

-- A2: the connected component.  A component whose outstanding sums to zero is
-- fully reconciled.  The matching identifier is COMPUTED here, never
-- denormalised onto a row - PHASE3 §6.7 records the bug the denormalisation
-- caused.
create or replace function erp.reconciliation_component(p_ple_id uuid)
  returns table (ple_id uuid, outstanding erp.amount)
  language sql stable as
$fn$
  with recursive comp (id) as (
      select p_ple_id
    union
      select case when e.debit_ple_id = c.id then e.credit_ple_id else e.debit_ple_id end
        from reconciliation_edge e
        join comp c on c.id in (e.debit_ple_id, e.credit_ple_id)
  )
  select o.ple_id, o.outstanding from v_ple_outstanding o join comp on comp.id = o.ple_id
$fn$;

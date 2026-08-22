-- ============================================================================
-- 010_org.sql   Organisation masters and the NOT NULL scoping set.
-- D10: the scoping columns are NOT NULL by construction so the
-- "blank means allow" footgun cannot exist.  §3.4: chart of accounts, fiscal
-- year, accounting-period lock, accounts_frozen_till and the Period Closing
-- Voucher are PER COMPANY; numbering, the filed lock, return periods,
-- place-of-supply and every GST report are PER REGISTRATION.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- company
-- ---------------------------------------------------------------------------
create table company (
  id                       uuid primary key,          -- UUIDv7, app-generated (OPEN ITEM O-1)
  tenant_id                uuid not null default erp.this_tenant(),
  code                     text not null,
  legal_name               text not null,
  pan                      erp.pan not null,
  default_currency         char(3) not null default 'INR',
  timezone                 text not null default 'Asia/Kolkata',   -- D17: UTC storage, business dates derived here
  books_start_date         date not null,
  round_off_account_id     uuid,                      -- FK added after account exists
  default_cost_center_id   uuid,                      -- §3.4 (i): makes gl_entry.cost_center_id NOT NULL satisfiable on day one
  ext                      jsonb not null default '{}',
  created_at               timestamptz not null default now(),
  created_by               uuid not null,
  updated_at               timestamptz not null default now(),
  updated_by               uuid not null,
  constraint company_code_uq unique (code)
);

-- ---------------------------------------------------------------------------
-- gstin_registration   §3.4: registration is the GST dimension, not the company
-- ---------------------------------------------------------------------------
create table gstin_registration (
  id                uuid primary key,
  tenant_id         uuid not null default erp.this_tenant(),
  company_id        uuid not null references company(id),
  gstin             erp.gstin not null,
  state_code        erp.state_code not null,
  legal_name        text not null,
  trade_name        text,
  registration_type text not null
                    check (registration_type in ('regular','composition','casual','sez_unit',
                                                 'sez_developer','isd','tds','tcs','uin')),
  is_sez            boolean not null default false,   -- T4: an SEZ counterparty is ALWAYS inter-state
  effective_from    date not null,
  effective_to      date,
  ext               jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  created_by        uuid not null,
  constraint gstin_registration_gstin_uq unique (gstin),
  -- Rule: the GSTIN carries its own state in its first two digits.  T4 reads
  -- source state as company GSTIN[:2]; if the column and the string disagree,
  -- every intra/inter-state decision is wrong.  Enforced, not assumed.
  constraint gstin_state_matches check (left(gstin, 2) = state_code),
  constraint gstin_period check (effective_to is null or effective_to > effective_from)
);
create index gstin_registration_company_ix on gstin_registration (company_id, state_code);

-- Rule 46(q) / Rule 55(1): every B2C invoice, bill of supply and delivery
-- challan still needs a signature; the IRP-signed QR substitutes only where
-- e-invoicing applies.  [VERIFY] q86.
create table authorised_signatory (
  id                 uuid primary key,
  registration_id    uuid not null references gstin_registration(id),
  full_name          text not null,
  designation        text not null,
  signature_asset_key text,        -- D18: object storage, tenant-scoped prefix
  dsc_reference      text,
  valid_from         date not null,
  valid_to           date,
  created_at         timestamptz not null default now(),
  created_by         uuid not null,
  constraint authsig_period check (valid_to is null or valid_to > valid_from),
  constraint authsig_evidence check (signature_asset_key is not null or dsc_reference is not null)
);
create index authsig_reg_ix on authorised_signatory (registration_id, valid_from desc);

-- ---------------------------------------------------------------------------
-- fiscal_year   §3.6: the India FY reset token exists in none of the scanned
-- repos.  Net-new; lives once in packages/domain/fiscal.ts and is consumed by
-- the series, the period gates and the GST returns alike.
-- ---------------------------------------------------------------------------
create table fiscal_year (
  id          uuid primary key,
  company_id  uuid not null references company(id),
  code        text not null,          -- '2025-26'
  from_date   date not null,
  to_date     date not null,
  is_closed   boolean not null default false,
  constraint fy_code_uq unique (company_id, code),
  constraint fy_order check (to_date > from_date),
  -- Indian statutory FY, 1 Apr - 31 Mar.  See OPEN ITEM O-2 before relaxing.
  constraint fy_india_boundaries check (
    extract(month from from_date) = 4 and extract(day from from_date) = 1 and
    extract(month from to_date)   = 3 and extract(day from to_date)   = 31),
  -- Two fiscal years of one company may not overlap.  Without this, the
  -- (registration, doctype, series, FY) numbering scope is ambiguous.
  constraint fy_no_overlap exclude using gist (
    company_id with =, daterange(from_date, to_date, '[]') with &&)
);

-- ---------------------------------------------------------------------------
-- Period control, part 1: the two per-company settings.
-- Part 2 (gstr_log, period_closing_voucher, the gate function) is in 060.
-- ---------------------------------------------------------------------------
create table company_accounts_settings (
  company_id            uuid primary key references company(id),
  -- L7 gate (b) / back-dating order 1.  There is deliberately NO bypass column:
  -- "admin explicitly denied the bypass" (§3.4).  Moving this date is itself an
  -- audited config change (D1).
  accounts_frozen_till  date,
  -- L3: the round-off line goes here.  The DB tolerance is ZERO; tolerance is a
  -- precision-derived app concept applied before insert (§3.4 step 7).
  round_off_account_id  uuid,
  round_off_cost_center_id uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid not null
);

-- L7 gate (a) / back-dating order 3.  The only gate with a named exempted role.
create table accounting_period (
  id                uuid primary key,
  company_id        uuid not null references company(id),
  name              text not null,
  from_date         date not null,
  to_date           date not null,
  is_document_locked boolean not null default false,
  exempted_roles    text[] not null default '{}',
  updated_at        timestamptz not null default now(),
  updated_by        uuid not null,
  constraint acctperiod_order check (to_date >= from_date),
  constraint acctperiod_no_overlap exclude using gist (
    company_id with =, daterange(from_date, to_date, '[]') with &&)
);

-- ---------------------------------------------------------------------------
-- account   Tree, leaf-only posting, root_type inherited.
-- ---------------------------------------------------------------------------
create table account (
  id               uuid primary key,
  tenant_id        uuid not null default erp.this_tenant(),
  company_id       uuid not null references company(id),
  parent_id        uuid references account(id),
  code             text not null,
  name             text not null,
  root_type        erp.root_type not null,
  account_type     text,             -- 'receivable'|'payable'|'bank'|'stock'|'tax'|'round_off'|...
  is_group         boolean not null default false,
  is_disabled      boolean not null default false,
  account_currency char(3) not null default 'INR',
  -- T5: tax character is authoritative data on the account, never derived from
  -- a report tag.  Report tags derive from it, never the reverse.
  tax_character    erp.tax_character,
  ext              jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  created_by       uuid not null,
  updated_at       timestamptz not null default now(),
  updated_by       uuid not null,
  constraint account_code_uq unique (company_id, code),
  constraint account_no_self_parent check (parent_id is distinct from id),
  -- Every account that carries a tax character must be a real tax account.
  constraint account_tax_char_requires_type
    check (tax_character is null or account_type = 'tax')
);
create index account_parent_ix on account (parent_id);
create index account_company_root_ix on account (company_id, root_type) where not is_group;

-- Tree integrity: a child inherits root_type from its parent, lives in the same
-- company, and the graph is acyclic.  Postgres cannot express any of these as a
-- CHECK, and every one of them silently corrupts a Trial Balance if violated.
create or replace function erp.tg_account_tree() returns trigger
  language plpgsql as
$fn$
declare p account%rowtype; depth int := 0; cur uuid;
begin
  if new.parent_id is not null then
    select * into p from account where id = new.parent_id;
    if not found then
      raise exception 'parent account % does not exist', new.parent_id using errcode = 'ERP42';
    end if;
    if not p.is_group then
      raise exception 'parent account % is not a group', p.code using errcode = 'ERP42';
    end if;
    if p.company_id <> new.company_id then
      raise exception 'account tree may not cross companies' using errcode = 'ERP43';
    end if;
    if p.root_type <> new.root_type then
      raise exception 'account % root_type % conflicts with parent root_type %',
        new.code, new.root_type, p.root_type using errcode = 'ERP42';
    end if;
    -- cycle check, bounded
    cur := new.parent_id;
    while cur is not null and depth < 64 loop
      if cur = new.id then
        raise exception 'account tree cycle at %', new.code using errcode = 'ERP42';
      end if;
      select parent_id into cur from account where id = cur;
      depth := depth + 1;
    end loop;
    if depth >= 64 then
      raise exception 'account tree deeper than 64 levels' using errcode = 'ERP42';
    end if;
  end if;
  return new;
end
$fn$;
create trigger account_tree before insert or update of parent_id, root_type, company_id
  on account for each row execute function erp.tg_account_tree();

-- ---------------------------------------------------------------------------
-- cost_center   D10: gl_entry.cost_center_id is NOT NULL, so exactly one
-- default per company must exist before any posting is possible.
-- ---------------------------------------------------------------------------
create table cost_center (
  id          uuid primary key,
  tenant_id   uuid not null default erp.this_tenant(),
  company_id  uuid not null references company(id),
  parent_id   uuid references cost_center(id),
  code        text not null,
  name        text not null,
  is_group    boolean not null default false,
  is_disabled boolean not null default false,
  is_default  boolean not null default false,
  ext         jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  created_by  uuid not null,
  constraint cost_center_code_uq unique (company_id, code),
  constraint cost_center_default_is_leaf check (not (is_default and is_group))
);
create unique index cost_center_one_default_ix
  on cost_center (company_id) where is_default;
create index cost_center_parent_ix on cost_center (parent_id);

-- §3.4 step 4: allocation percentages total exactly 100, no chaining.
create table cost_center_allocation (
  id             uuid primary key,
  company_id     uuid not null references company(id),
  source_cost_center_id uuid not null references cost_center(id),
  valid_from     date not null,
  valid_to       date,
  constraint cca_period check (valid_to is null or valid_to > valid_from),
  -- One live allocation per source at a time; overlapping allocations make the
  -- explosion non-deterministic.
  constraint cca_no_overlap exclude using gist (
    source_cost_center_id with =, daterange(valid_from, valid_to) with &&)
);
create table cost_center_allocation_line (
  id             uuid primary key,
  allocation_id  uuid not null references cost_center_allocation(id) on delete cascade,
  target_cost_center_id uuid not null references cost_center(id),
  percentage     erp.pct not null check (percentage > 0),
  constraint ccal_uq unique (allocation_id, target_cost_center_id)
);
-- Percentages total exactly 100.  Deferred: the lines arrive after the header.
create or replace function erp.assert_cca_totals_100() returns trigger
  language plpgsql as
$fn$
declare t numeric; a uuid;
begin
  a := coalesce(new.allocation_id, old.allocation_id);
  select sum(percentage) into t from cost_center_allocation_line where allocation_id = a;
  if t is not null and t <> 100 then
    raise exception 'cost centre allocation % totals %, must be exactly 100', a, t
      using errcode = 'ERP40';
  end if;
  return null;
end
$fn$;
create constraint trigger cca_totals_100 after insert or update or delete
  on cost_center_allocation_line deferrable initially deferred
  for each row execute function erp.assert_cca_totals_100();

-- Now that account and cost_center exist, close the company FKs.
alter table company
  add constraint company_round_off_fk foreign key (round_off_account_id) references account(id),
  add constraint company_default_cc_fk foreign key (default_cost_center_id) references cost_center(id);
alter table company_accounts_settings
  add constraint cas_round_off_fk foreign key (round_off_account_id) references account(id),
  add constraint cas_round_off_cc_fk foreign key (round_off_cost_center_id) references cost_center(id);

-- ---------------------------------------------------------------------------
-- party   §3.2: "Party as a supertype table with real FKs (no Dynamic Link
-- polymorphism)".  The (id, party_type) unique key is what lets
-- payment_ledger_entry carry a COMPOSITE foreign key instead of a polymorphic
-- pair - which is the difference between a real FK and ERPNext Dynamic Link.
-- ---------------------------------------------------------------------------
create table party (
  id             uuid primary key,
  tenant_id      uuid not null default erp.this_tenant(),
  party_type     erp.party_type not null,
  code           text not null,
  name           text not null,
  pan            erp.pan,                 -- A7: 194Q/206C(1H) aggregate by PAN, not by party row
  -- A8 / §43B(h): scoped to micro and small only; medium is understood to fall
  -- outside.  [VERIFY] q34-block.
  udyam_number   text,
  msme_class     text check (msme_class in ('micro','small','medium')),
  -- L6: party currency is permanently fixed to that of its first GL entry
  -- per company.  Written once by the posting chokepoint, never by a user.
  default_currency char(3),
  is_disabled    boolean not null default false,
  ext            jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  created_by     uuid not null,
  updated_at     timestamptz not null default now(),
  updated_by     uuid not null,
  constraint party_code_uq unique (party_type, code),
  constraint party_supertype_uq unique (id, party_type),   -- the composite-FK anchor
  constraint party_msme_needs_udyam
    check (msme_class is null or udyam_number is not null)
);
create index party_pan_ix on party (pan) where pan is not null;

-- L6: currency locked at first posting, per company.
create table party_currency_lock (
  party_id   uuid not null references party(id),
  company_id uuid not null references company(id),
  currency   char(3) not null,
  locked_by_gl_seq bigint not null,
  locked_at  timestamptz not null default now(),
  primary key (party_id, company_id)
);

-- T14 / T4 need the counterparty GSTIN and its registration type, effective-dated.
-- The plan names none of this; see OPEN ITEM O-3.
create table party_gstin (
  id                uuid primary key,
  party_id          uuid not null references party(id),
  gstin             erp.gstin,
  state_code        erp.state_code not null,
  registration_type text not null
                    check (registration_type in ('regular','composition','unregistered',
                                                 'sez_unit','sez_developer','overseas',
                                                 'uin','deemed_export')),
  valid_from        date not null,
  valid_to          date,
  created_at        timestamptz not null default now(),
  created_by        uuid not null,
  constraint party_gstin_state_matches
    check (gstin is null or left(gstin, 2) = state_code),
  -- T14 V6: no GST on a non-RCM purchase from a supplier with no GSTIN - which
  -- is only checkable if "unregistered" is a modelled state rather than a null.
  constraint party_gstin_unregistered_has_no_gstin
    check ((registration_type = 'unregistered') = (gstin is null)),
  constraint party_gstin_period check (valid_to is null or valid_to > valid_from),
  constraint party_gstin_no_overlap exclude using gist (
    party_id with =, state_code with =, daterange(valid_from, valid_to) with &&)
);

create table address (
  id           uuid primary key,
  party_id     uuid references party(id),
  company_id   uuid references company(id),
  address_type text not null check (address_type in ('billing','shipping','registered','plant')),
  line1        text not null,
  line2        text,
  city         text not null,
  state_code   erp.state_code not null,   -- T4: unregistered counterparty resolves state from here
  pincode      text check (pincode ~ '^[1-9][0-9]{5}$'),
  country_code char(2) not null default 'IN',
  ext          jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  created_by   uuid not null,
  constraint address_belongs_to_one check (num_nonnulls(party_id, company_id) = 1)
);
create index address_party_ix on address (party_id);

create table contact (
  id         uuid primary key,
  party_id   uuid references party(id),
  full_name  text not null,
  email      text,
  phone      text,
  ext        jsonb not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid not null
);

create table bank_account (
  id           uuid primary key,
  company_id   uuid references company(id),
  party_id     uuid references party(id),
  account_id   uuid references account(id),   -- the GL account, when it is ours
  account_name text not null,
  account_no   text not null,
  ifsc         text check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  ext          jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  created_by   uuid not null,
  constraint bank_account_owner check (num_nonnulls(company_id, party_id) = 1),
  constraint bank_account_gl_only_for_company
    check (account_id is null or company_id is not null)
);

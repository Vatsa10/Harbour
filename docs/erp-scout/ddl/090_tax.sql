-- ============================================================================
-- 090_tax.sql   §3.10 / T1-T15.  The tax data model.  REQUIRED BEFORE STAGE 2.
--
-- Repartition is a real model, not a decoration: an ordered invoice-list and
-- refund-list of identical length, factor, account, tag, per tax - and it is
-- the mechanism for BOTH reverse charge (T7) and ineligible ITC, i.e. two
-- N-rated compliance gates.
--
-- T5: tax character is AUTHORITATIVE DATA, never derived from a report tag.
-- Report tags derive from it, never the reverse - explicitly rejecting the
-- direction where editing a repartition tag silently changes a tax's identity
-- and the HSN summary follows.
--
-- T6 / N11: the GSTR section is stamped PER LINE AT POST TIME into a STORED
-- table.  A computed view would reclassify history on every code change, which
-- is "the single most common source of filing mismatches".
-- ============================================================================
\set ON_ERROR_STOP on

create table tax_category (
  id             uuid primary key,
  company_id     uuid not null references company(id),
  code           text not null,
  name           text not null,
  is_reverse_charge boolean not null default false,
  -- T4: an SEZ counterparty is ALWAYS inter-state.  Modelled as a category
  -- property so it is not a name-string test.
  forces_inter_state boolean not null default false,
  created_at     timestamptz not null default now(),
  created_by     uuid not null,
  constraint tax_category_uq unique (company_id, code)
);

create table tax_template (
  id             uuid primary key,
  company_id     uuid not null references company(id),
  code           text not null,
  name           text not null,
  doc_direction  text not null check (doc_direction in ('sales','purchase')),
  tax_category_id uuid references tax_category(id),
  is_disabled    boolean not null default false,
  created_at     timestamptz not null default now(),
  created_by     uuid not null,
  constraint tax_template_uq unique (company_id, code)
);

create table tax_template_row (
  id                 uuid primary key,
  template_id        uuid not null references tax_template(id) on delete cascade,
  sequence           smallint not null,
  -- T2's flatten-and-batch reads charge_type, price_include and
  -- include_base_amount to decide which taxes SHARE A BASE.  All three are
  -- columns for that reason.
  charge_type        text not null
                     check (charge_type in ('on_net_total','on_previous_row_amount',
                                            'on_previous_row_total','actual','on_item_quantity')),
  previous_row_seq   smallint,
  rate               erp.pct,
  amount             erp.amount,          -- only for charge_type = 'actual'
  account_id         uuid not null references account(id),
  tax_character      erp.tax_character,   -- T5: authoritative
  include_base_amount boolean not null default false,
  price_include      boolean not null default false,
  -- T12: fixed charges do not shrink with a discount.
  is_discountable_base boolean not null default true,
  description        text,
  constraint ttr_seq_uq unique (template_id, sequence),
  constraint ttr_prev_row_required
    check ((charge_type in ('on_previous_row_amount','on_previous_row_total'))
           = (previous_row_seq is not null)),
  constraint ttr_prev_row_is_earlier
    check (previous_row_seq is null or previous_row_seq < sequence),
  constraint ttr_actual_has_amount
    check ((charge_type = 'actual') = (amount is not null)),
  constraint ttr_rate_required
    check (charge_type = 'actual' or rate is not null),
  -- T4 validation 4: no GST row on "On Previous Row Amount".
  constraint ttr_no_gst_on_prev_row_amount
    check (tax_character is null or charge_type <> 'on_previous_row_amount'),
  -- T4 validation 5: "On Item Quantity" only for cess_non_advol.
  constraint ttr_qty_charge_is_cess_non_advol
    check (charge_type <> 'on_item_quantity' or tax_character = 'cess_non_advol'),
  -- T12 / T2: an actual or per-quantity charge is never part of the
  -- discountable base and never price-included.
  constraint ttr_fixed_charges_excluded_from_discount
    check (charge_type not in ('actual','on_item_quantity') or not is_discountable_base),
  constraint ttr_fixed_charges_not_price_included
    check (charge_type <> 'actual' or not price_include)
);

-- T7.  Ordered invoice and refund repartition lists of IDENTICAL LENGTH.
-- Positive tax factors sum to +100; negatives, if any, sum to -100 - that is
-- the RCM pattern, emitting a mirror leg with inverted amount.  The same
-- mechanism routes ineligible ITC into expense or valuation.
create table tax_repartition_line (
  id               uuid primary key,
  template_row_id  uuid not null references tax_template_row(id) on delete cascade,
  kind             text not null check (kind in ('invoice','refund')),
  ordinal          smallint not null,
  applies_to       text not null default 'tax' check (applies_to in ('base','tax')),
  factor           erp.pct not null,        -- percentage, signed
  account_id       uuid references account(id),
  tag              text,                    -- DERIVED reporting label; never the identity (T5)
  constraint trl_uq unique (template_row_id, kind, ordinal),
  constraint trl_factor_nonzero check (factor <> 0)
);

-- The two structural invariants of a repartition set.  Deferred: the lines
-- arrive after the row, and both lists must be complete before either is valid.
create or replace function erp.assert_repartition_balanced() returns trigger
  language plpgsql as
$fn$
declare r uuid; n_inv int; n_ref int; pos numeric; neg numeric; k text;
begin
  r := coalesce(new.template_row_id, old.template_row_id);
  select count(*) filter (where kind = 'invoice'),
         count(*) filter (where kind = 'refund')
    into n_inv, n_ref
    from tax_repartition_line where template_row_id = r;
  if n_inv = 0 and n_ref = 0 then
    return null;                          -- fully deleted; nothing to assert
  end if;
  if n_inv <> n_ref then
    raise exception 'repartition lists differ in length for tax row % (invoice %, refund %)',
      r, n_inv, n_ref using errcode = 'ERP72';
  end if;
  foreach k in array array['invoice','refund'] loop
    select coalesce(sum(factor) filter (where factor > 0), 0),
           coalesce(sum(factor) filter (where factor < 0), 0)
      into pos, neg
      from tax_repartition_line
     where template_row_id = r and kind = k and applies_to = 'tax';
    if pos <> 100 then
      raise exception 'positive % repartition factors for tax row % sum to %, must be 100',
        k, r, pos using errcode = 'ERP72';
    end if;
    if neg <> 0 and neg <> -100 then
      raise exception 'negative % repartition factors for tax row % sum to %, must be 0 or -100',
        k, r, neg using errcode = 'ERP72';
    end if;
  end loop;
  return null;
end
$fn$;
create constraint trigger repartition_balanced
  after insert or update or delete on tax_repartition_line
  deferrable initially deferred
  for each row execute function erp.assert_repartition_balanced();

-- T11.  Bounded templates preferred, sorted valid_from desc, matched on tax
-- category.  valid_from is the ordering key T11 names.
create table item_tax_template (
  id              uuid primary key,
  company_id      uuid not null references company(id),
  code            text not null,
  name            text not null,
  tax_category_id uuid references tax_category(id),
  valid_from      date not null,
  created_at      timestamptz not null default now(),
  created_by      uuid not null,
  constraint item_tax_template_uq unique (company_id, code, valid_from)
);
create index item_tax_template_lookup_ix
  on item_tax_template (company_id, tax_category_id, valid_from desc);

create table item_tax_template_row (
  id            uuid primary key,
  template_id   uuid not null references item_tax_template(id) on delete cascade,
  account_id    uuid not null references account(id),
  tax_character erp.tax_character not null,
  rate          erp.pct not null,
  constraint ittr_uq unique (template_id, account_id)
);

-- ---------------------------------------------------------------------------
-- document_line_tax   The stored per-line tax result.  DAY-ONE DECISION.
-- Append-only: reclassifying a filed line is exactly what this table exists to
-- prevent.
-- ---------------------------------------------------------------------------
create table document_line_tax (
  id                 uuid primary key,
  tenant_id          uuid not null default erp.this_tenant(),
  document_type      text not null references erp.document_type(doc_type),
  document_id        uuid not null,
  document_line_id   uuid not null,
  company_id         uuid not null references company(id),
  registration_id    uuid not null references gstin_registration(id),
  -- T8: exemption is not zero.  Nil / Exempt / Non-GST are three DISTINCT
  -- states, never blank.
  gst_treatment      erp.gst_treatment not null,
  tax_character      erp.tax_character not null,
  rate               erp.pct not null,
  taxable_value      erp.amount not null,
  tax_amount         erp.amount not null,
  -- T6: the GSTR section, stamped AT POST TIME.
  gstr_section       text not null,        -- 'B2B'|'B2CL'|'B2CS'|'CDNR'|'EXP'|'NIL'|...
  hsn_code           text,
  uqc                text,
  is_reverse_charge  boolean not null default false,
  is_ineligible_itc  boolean not null default false,
  posting_date       date not null,
  gst_report_period  erp.gst_period not null,
  ruleset_version_id uuid not null references ruleset_version(id),
  created_at         timestamptz not null default now(),
  created_by         uuid not null,
  constraint dlt_uq unique (document_line_id, tax_character),
  -- T10: 4, 6 or 8 digits only - never 5 or 7.  99xx implies a service.
  constraint dlt_hsn_digits
    check (hsn_code is null or hsn_code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
  -- T8: a non-taxable treatment carries a zero rate and a zero amount, and it
  -- is still a ROW - "no GST rows" is what produced blank returns in the
  -- reference.
  constraint dlt_non_taxable_is_zero
    check (gst_treatment = 'taxable' or (rate = 0 and tax_amount = 0))
);
create index dlt_doc_ix on document_line_tax (document_type, document_id);
create index dlt_gstr_ix on document_line_tax
  (registration_id, gst_report_period, gstr_section);
-- T15: the HSN summary is grouped by (HSN, UoM, COMBINED rate) where combined
-- is the SUM of distinct igst/cgst/sgst rates, so a 2.5+2.5 intra-state line
-- groups with an IGST-5 line.  Cess is excluded from the key.
create index dlt_hsn_summary_ix on document_line_tax
  (registration_id, gst_report_period, hsn_code, uqc)
  where tax_character in ('igst','cgst','sgst','utgst');

select erp.make_append_only('public', 'document_line_tax');

create view v_hsn_summary as
  select registration_id, gst_report_period, hsn_code, uqc,
         sum(rate) filter (where tax_character in ('igst','cgst','sgst','utgst')) as combined_rate,
         sum(taxable_value) filter (where tax_character = 'igst'
                                       or tax_character = 'cgst')  as taxable_value,
         sum(tax_amount) filter (where tax_character = 'igst')      as igst,
         sum(tax_amount) filter (where tax_character = 'cgst')      as cgst,
         sum(tax_amount) filter (where tax_character in ('sgst','utgst')) as sgst_utgst,
         sum(tax_amount) filter (where tax_character in ('cess','cess_non_advol')) as cess
    from document_line_tax
   group by registration_id, gst_report_period, hsn_code, uqc;

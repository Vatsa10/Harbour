-- ============================================================================
-- 110_sales_invoice.sql   The worked example.
-- One statutory document, applying the spine.  Every other submittable document
-- (~27 of them, §3.2) is the same three steps:
--   1. create the table with ONLY its own commercial columns and its own PK,
--   2. call erp.add_document_spine(...),
--   3. create the line table with a FK back and its own tax/commercial columns.
-- If a document needs a column the spine already has, that is a bug in the
-- spine, not a reason to duplicate it.
-- ============================================================================
\set ON_ERROR_STOP on

create table sales_invoice (
  id                 uuid primary key,
  customer_id        uuid not null,
  customer_type      erp.party_type not null default 'customer',
  billing_address_id uuid references address(id),
  shipping_address_id uuid references address(id),
  -- T4 [GATE]: place of supply is MANDATORY.  Returning FALSE when PoS is blank
  -- is the reference anti-pattern; failing loudly is the rule.
  place_of_supply    erp.state_code not null,
  counterparty_gstin erp.gstin,
  tax_category_id    uuid references tax_category(id),
  tax_template_id    uuid references tax_template(id),
  currency           char(3) not null default 'INR',
  exchange_rate      erp.fx not null default 1,
  net_total          erp.amount not null default 0,
  total_taxes        erp.amount not null default 0,
  rounding_adjustment erp.amount not null default 0,
  grand_total        erp.amount not null default 0,
  -- §3.4: a branch-transfer invoice is a real invoice, flagged, and EXCLUDED by
  -- an explicit report rule from consolidated revenue, COGS and aggregate
  -- turnover.  A flag on the document, not a filter someone remembers.
  is_internal_supply boolean not null default false,
  -- §3.4 / §5.5 q24-33: the §143 route.  supply_date is a STORED field; the
  -- invoice does NOT back-date.  Interest computes from supply_date; the GL and
  -- the return land in the current open period.
  supply_date        date,
  late_disclosed     boolean not null default false,
  -- Rule 46(q) / Rule 55(1): the signature reference, per GSTIN.
  authorised_signatory_id uuid references authorised_signatory(id),
  -- Rule 55(4) SKD/CKD and batch consignment: a real document linkage.
  parent_consignment_invoice_id uuid references sales_invoice(id),
  remarks            text,
  constraint si_customer_fk foreign key (customer_id, customer_type)
    references party (id, party_type),
  constraint si_customer_is_customer check (customer_type = 'customer'),
  constraint si_supply_date_pairs_late
    check ((supply_date is not null) or not late_disclosed),
  constraint si_totals check (grand_total = net_total + total_taxes + rounding_adjustment)
);

select erp.add_document_spine(
  'public', 'sales_invoice', 'sales_invoice',
  p_is_statutory   := true,
  p_requires_series := true,
  p_series_nature  := 'tax_invoice');

create index sales_invoice_customer_ix on sales_invoice (customer_id, posting_date);

create table sales_invoice_line (
  id                 uuid primary key,
  invoice_id         uuid not null references sales_invoice(id) on delete cascade,
  line_no            smallint not null,
  item_id            uuid,                    -- FK added in Stage 3 with the item master
  description        text not null,
  hsn_code           text,
  uqc                text,
  qty                erp.qty not null,
  uom                text not null,
  rate               erp.rate not null,
  discount_pct       erp.pct not null default 0,
  net_amount         erp.amount not null,
  item_tax_template_id uuid references item_tax_template(id),
  gst_treatment      erp.gst_treatment not null,
  cost_center_id     uuid not null references cost_center(id),   -- D10
  ext                jsonb not null default '{}',
  constraint sil_line_uq unique (invoice_id, line_no),
  constraint sil_qty_positive check (qty > 0),
  -- T10 [GATE]: 4, 6 or 8 digits only, never 5 or 7.  Hard throw at submit is
  -- the service rule; this constraint stops the shape at any depth.
  constraint sil_hsn_digits
    check (hsn_code is null or hsn_code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
  constraint sil_discount_range check (discount_pct >= 0 and discount_pct <= 100)
);

-- The child table is audited exactly like the parent (§3.5: field-level deltas
-- INCLUDING child rows, grouped by event_id) - which is the repository layer's
-- job, not a trigger's, because the actor and the event id live in the request.

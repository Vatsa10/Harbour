#!/usr/bin/env bash
# ============================================================================
# apply.sh   Apply the Stage 1 + Stage 2 core data model to one tenant database.
#
#   ./apply.sh <dbname> [--acceptance]
#
# The order below is a dependency order, not a preference.  001 is cluster-wide
# and idempotent; everything else is per tenant database/schema.
#
# In production this ordering lives in the migrator (apps/migrator), which is
# the ONLY process permitted to run DDL (D7).  This script is the local
# equivalent and the CI entry point.
# ============================================================================
set -euo pipefail

DB="${1:?usage: apply.sh <dbname> [--acceptance]}"
DIR="$(cd "$(dirname "$0")" && pwd)"

FILES=(
  001_roles            # cluster roles: erp_app / erp_migrator / erp_retention / erp_reconciler / erp_reader
  000_conventions      # extensions, money domains, closed value sets, error codes, session context
  010_org              # company, gstin_registration, fiscal_year, accounting_period,
                       #   account, cost_center, party (+ the composite-FK anchor), address
  020_rule_store       # statutory_rule (GiST no-overlap), ruleset_version/member, resolve()
  030_audit            # audit_log (partitioned, PG17), chain head + chain link, audit_verify
  040_numbering        # document_series, document_number_register, allocator, continuity auditor
  050_document_spine   # erp.document_type, the immutability trigger, add_document_spine(), artifacts
  060_period_control   # gstr_log, period_closing_voucher, assert_period_open() (4 gates, 1 order)
  070_gl               # gl_entry, guards, the deferred balance assertion, flush helper
  080_ple              # payment_ledger_entry, reconciliation_edge, the two canonical CTEs
  090_tax              # tax_category/template/row, repartition, item tax templates, document_line_tax
  100_overlay          # registry_build/field, field_extension | (gated on Q9) property_override
  110_sales_invoice    # the worked example: one statutory document on the spine
  900_grants           # the privilege matrix - half the enforcement of D1 and §3.4
)

for f in "${FILES[@]}"; do
  echo "==> $f"
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$DIR/$f.sql"
done

if [[ "${2:-}" == "--acceptance" ]]; then
  echo "==> 910_acceptance"
  psql -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/910_acceptance.sql"

  # The one class of assertion the in-database suite cannot make: GRANTs.
  # 910 runs as the owner, where the triggers do the work; this proves the
  # application role is stopped one layer earlier, by privilege.
  echo "==> grant-level check (must fail with 42501)"
  psql -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
begin
  set local role erp_app;
  begin
    update gl_entry set debit = 1;
    raise exception 'FAIL: erp_app was permitted to UPDATE gl_entry';
  exception when insufficient_privilege then
    raise notice 'PASS  erp_app has no UPDATE grant on gl_entry (42501)';
  end;
  begin
    delete from audit_log;
    raise exception 'FAIL: erp_app was permitted to DELETE from audit_log';
  exception when insufficient_privilege then
    raise notice 'PASS  erp_app has no DELETE grant on audit_log (42501)';
  end;
  reset role;
end
$$;
SQL
fi

echo "done."

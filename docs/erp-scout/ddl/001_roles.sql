-- ============================================================================
-- 001_roles.sql   RUN ONCE PER CLUSTER, BEFORE 000_conventions.sql.
-- Roles are cluster-global; every other file in this set is per tenant
-- database/schema.  The privilege split is load-bearing, not hygiene:
-- D1 (append-only audit) and §3.4 (append-only ledgers) are stated as
-- "the application role has no UPDATE/DELETE grant", which is only true if
-- the application never connects as the owner.
-- ============================================================================
\set ON_ERROR_STOP on

do $do$
begin
  -- Owns nothing.  DML only.  This is the API and worker connection.
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    create role erp_app nologin;
  end if;

  -- Owns every object created by these files.  DDL, bulk import, and the ONLY
  -- role permitted to set erp.posting_mode = 'migration' (L11).
  if not exists (select 1 from pg_roles where rolname = 'erp_migrator') then
    create role erp_migrator nologin;
  end if;

  -- §3.5 property 3: retention is a SEPARATE role that may only DETACH
  -- PARTITION, and the detach is itself logged.  No DML on audit_log.
  if not exists (select 1 from pg_roles where rolname = 'erp_retention') then
    create role erp_retention nologin;
  end if;

  -- A2: unreconciliation is DELETE on reconciliation_edge by a named role.
  -- It is the single deliberate exception to append-only in the ledger set.
  if not exists (select 1 from pg_roles where rolname = 'erp_reconciler') then
    create role erp_reconciler nologin;
  end if;

  -- Report engine / analytics.  SELECT only, and never on the posting path.
  if not exists (select 1 from pg_roles where rolname = 'erp_reader') then
    create role erp_reader nologin;
  end if;
end
$do$;

-- Login roles are created per deployment, e.g.
--   create role erp_api login password :'pw' in role erp_app;
--   create role erp_mig login password :'pw' in role erp_migrator;
-- The tenant login role is granted USAGE on ONLY its own schema (§3.7): a wrong
-- search_path must error, not leak.

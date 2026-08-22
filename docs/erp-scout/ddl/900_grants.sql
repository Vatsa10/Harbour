-- ============================================================================
-- 900_grants.sql   The privilege matrix.  Run LAST, after every object exists.
-- This file is half the enforcement of D1 and §3.4: "the application role has
-- no UPDATE/DELETE grant on either ledger" is a GRANT statement, not a comment.
-- ============================================================================
\set ON_ERROR_STOP on

-- Baseline: the app may read everything in its own schema and nothing outside it.
grant usage on schema public, erp to erp_app, erp_reader, erp_migrator, erp_retention, erp_reconciler;
grant select on all tables in schema public, erp to erp_app, erp_reader;
grant insert, update, delete on all tables in schema public to erp_app;
grant execute on all functions in schema erp to erp_app;
grant usage, select on all sequences in schema public to erp_app;

-- ---- The append-only set.  INSERT only, for everyone including the owner ----
revoke update, delete, truncate on gl_entry              from erp_app, erp_reader;
revoke update, delete, truncate on payment_ledger_entry  from erp_app, erp_reader;
revoke update, delete, truncate on document_line_tax     from erp_app, erp_reader;
revoke update, delete, truncate on einvoice_artifact     from erp_app, erp_reader;
revoke update, delete, truncate on ewb_artifact          from erp_app, erp_reader;
revoke update, delete, truncate on audit_log             from erp_app, erp_reader;
revoke update, delete, truncate on audit_chain_link      from erp_app, erp_reader;
revoke insert, update, delete, truncate on audit_daily_digest from erp_app;

-- statutory_rule: the migrator owns it.  The app reads.
revoke insert, update, delete, truncate on statutory_rule   from erp_app;
revoke insert, update, delete, truncate on ruleset_version  from erp_app;
revoke insert, update, delete, truncate on ruleset_member   from erp_app;
revoke insert, update, delete, truncate on gl_dimension_key from erp_app;
revoke insert, update, delete, truncate on registry_build   from erp_app;
revoke insert, update, delete, truncate on registry_field   from erp_app;
grant  insert, update, delete on statutory_rule, ruleset_version, ruleset_member,
       gl_dimension_key, registry_build, registry_field to erp_migrator;

-- A2's one deliberate exception: unreconciliation is DELETE by a named role.
revoke delete on reconciliation_edge from erp_app;
grant  delete on reconciliation_edge to erp_reconciler;
revoke update on reconciliation_edge from erp_app, erp_reconciler;

-- D2: a consumed number is never released.  The register is written only
-- through erp.allocate_doc_no (and cancelled by the cancel path).
revoke delete, truncate on document_number_register from erp_app;
revoke delete, truncate on series_gap               from erp_app;

-- §3.5 property 3: retention is a SEPARATE role that may only DETACH PARTITION.
-- The detach goes through the SECURITY DEFINER function, which audits first.
grant execute on function erp.audit_detach_partition(text, text) to erp_retention;
revoke all on audit_log from erp_retention;
grant select on audit_log to erp_retention;

-- The migrator is the only DDL path (D7) and the only role that may run the
-- bulk number reservation and the extension-field promotion.
revoke execute on function erp.reserve_doc_no_range(uuid, int)               from erp_app;
revoke execute on function erp.promote_extension_field(text,text,text,text,boolean) from erp_app;
grant  execute on function erp.reserve_doc_no_range(uuid, int)               to erp_migrator;
grant  execute on function erp.promote_extension_field(text,text,text,text,boolean) to erp_migrator;
grant  insert, update, delete on all tables in schema public to erp_migrator;
grant  execute on all functions in schema erp to erp_migrator;
grant  usage, select on all sequences in schema public to erp_migrator;

-- Reports read; they never write, and they never see a raw connection (§3.10).
revoke insert, update, delete, truncate on all tables in schema public from erp_reader;

-- Future objects inherit the baseline, so a new table is not accidentally
-- writable by the reader or unreadable by the app.
alter default privileges in schema public grant select on tables to erp_app, erp_reader;
alter default privileges in schema public grant insert, update, delete on tables to erp_app;

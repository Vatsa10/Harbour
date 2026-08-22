-- ============================================================================
-- 100_overlay.sql   §3.2 / D11.  The metadata overlay.
--
-- SEQUENCING, and it matters: only `ext jsonb` + field_extension are genuinely
-- DAY ONE - they are a column, and columns are what you cannot retrofit.
-- property_override, the 91-property allowlist and the inspector are a STAGE 2
-- slot GATED ON §10 Q9.  Apply 100a first; apply 100b only when Q9 says yes.
--
-- Extension fields are JSONB, not runtime ALTER TABLE.  A desired-state differ
-- computes DROP for any column not in the model, so tenant #47's extra column
-- would need hand-auditing on every future diff forever.  Adding a field is an
-- INSERT, not DDL: no lock, no migration window, no orphan-column reaper.
--
-- The audit writer serialises the WHOLE ROW including ext, so customer fields
-- are audited the instant they exist with no registry walk.
--
-- STATUTORY FIELDS ARE NEVER EXTENSION FIELDS - nothing a CA cares about
-- depends on this mechanism.  Enforced below, not asserted.
-- ============================================================================
\set ON_ERROR_STOP on

-- --------------------------------------------------------------------- 100a
-- The build-time registry, generated from the Drizzle schema into
-- registry.json and loaded here by the migrator.  Metadata is a PROJECTION OF
-- CODE, not a substitute for it - which is what makes the extension-field
-- collision check below a database constraint rather than a convention.
-- ---------------------------------------------------------------------------
create table registry_build (
  id          uuid primary key,
  built_at    timestamptz not null,
  git_sha     text not null,
  digest      bytea not null,
  is_current  boolean not null default false
);
create unique index registry_build_current_uq on registry_build (is_current) where is_current;

create table registry_field (
  build_id     uuid not null references registry_build(id) on delete cascade,
  entity       text not null,
  field_name   text not null,
  data_type    text not null,
  -- The half that makes "statutory fields are never extension fields"
  -- enforceable: a field the registry marks statutory can never be overridden
  -- or shadowed.
  is_statutory boolean not null default false,
  primary key (build_id, entity, field_name)
);

create table field_extension (
  id          uuid primary key,
  tenant_id   uuid not null default erp.this_tenant(),
  entity      text not null,
  field_key   text not null,           -- the key inside ext jsonb
  data_type   text not null
              check (data_type in ('text','int','numeric','date','timestamptz',
                                   'boolean','uuid','jsonb')),
  label       text not null,
  is_mandatory boolean not null default false,
  validation  jsonb not null default '{}',   -- typed JSON-AST, evaluated by ONE shared evaluator
  -- Provenance: who asked for this and why.  Cheap now, undebuggable later.
  requested_by text,
  reason      text,
  created_at  timestamptz not null default now(),
  created_by  uuid not null,
  constraint field_extension_uq unique (entity, field_key),
  -- A jsonb key, not an identifier: it must survive round-tripping and must not
  -- look like a column.
  constraint field_extension_key_shape check (field_key ~ '^[a-z][a-z0-9_]{0,62}$')
);

-- The collision check.  An extension field may not shadow a base field, and it
-- may never be created against a statutory field name.
create or replace function erp.tg_field_extension_guard() returns trigger
  language plpgsql as
$fn$
declare b uuid;
begin
  select id into b from registry_build where is_current;
  if b is null then
    raise exception 'no current registry build; load registry.json before declaring extension fields'
      using errcode = 'ERP70';
  end if;
  if exists (select 1 from registry_field
              where build_id = b and entity = new.entity and field_name = new.field_key) then
    raise exception 'extension field %.% shadows a base field', new.entity, new.field_key
      using errcode = 'ERP70',
            hint = 'Promote it with a generated column instead, or pick another key.';
  end if;
  if not exists (select 1 from registry_field where build_id = b and entity = new.entity) then
    raise exception 'entity % is not in the current registry build', new.entity
      using errcode = 'ERP70';
  end if;
  return new;
end
$fn$;
create trigger field_extension_guard before insert or update on field_extension
  for each row execute function erp.tg_field_extension_guard();

-- The promotion path, documented as code so it is not folklore.  When an
-- extension field needs an index, a unique constraint or a hot report filter,
-- the MIGRATOR adds a generated column plus its index.  A normal reviewed
-- migration; tenant data untouched.
create or replace function erp.promote_extension_field(
  p_schema text, p_table text, p_field_key text, p_sql_type text, p_unique boolean default false)
  returns void language plpgsql as
$fn$
declare col text := 'x_' || p_field_key;
begin
  if erp.posting_mode() <> 'migration' then
    raise exception 'extension-field promotion runs in the migrator only (D7)' using errcode = 'ERP61';
  end if;
  execute format(
    'alter table %I.%I add column %I %s generated always as ((ext->>%L)::%s) stored',
    p_schema, p_table, col, p_sql_type, p_field_key, p_sql_type);
  execute format('create %s index %I on %I.%I (%I)',
    case when p_unique then 'unique' else '' end,
    p_table || '_' || col || '_ix', p_schema, p_table, col);
end
$fn$;

-- The cache-invalidation counter.  Bumped by ANY write to either overlay table.
-- The bump IS the invalidation event; it is published on the Redis
-- client-side-invalidation channel.  There is NO wall-clock TTL - a stale form
-- that silently ignores a mandatory flag is a compliance defect, not a cache miss.
create table overlay_version (
  tenant_id  uuid primary key default erp.this_tenant(),
  version    bigint not null default 0,
  bumped_at  timestamptz not null default now()
);

create or replace function erp.tg_bump_overlay_version() returns trigger
  language plpgsql as
$fn$
begin
  insert into overlay_version (tenant_id) values (erp.this_tenant())
    on conflict (tenant_id) do update
      set version = overlay_version.version + 1, bumped_at = now();
  return null;
end
$fn$;
create trigger field_extension_bump after insert or update or delete on field_extension
  for each statement execute function erp.tg_bump_overlay_version();

-- --------------------------------------------------------------------- 100b
-- GATED ON §10 Q9.  Everything below this line is a STAGE 2 deliverable and
-- ships only if extension-field / override demand is evidenced.
-- ---------------------------------------------------------------------------

-- The 91-property allowlist, copied verbatim from Frappe (MIT, customize_form.py),
-- copyright preserved in ATTRIBUTIONS.md.  Seeded by 930_seed_properties.sql.
create table overridable_property (
  property     text primary key,
  applies_to   text not null check (applies_to in ('field','entity','permission')),
  value_type   text not null,
  description  text
);

create table property_override (
  id         uuid primary key,
  tenant_id  uuid not null default erp.this_tenant(),
  entity     text not null,
  field      text,                    -- null for entity-level properties
  property   text not null references overridable_property(property),
  -- THE dimension Frappe lacks.  Its absence means an app-shipped setter
  -- silently destroys a customer's change with no conflict, no warning and no
  -- log entry.  vertical_app is DELETED from the enum until the module contract
  -- exists (§3.11); shipping a three-valued key whose middle value has no
  -- referent is worse than either choice.
  layer      text not null check (layer in ('core','tenant')),
  value      jsonb not null,
  reason     text,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  constraint property_override_uq unique (entity, field, property, layer)
);
create index property_override_entity_ix on property_override (entity, field);

-- Statutory fields are never overridden either.  Same registry, same check.
create or replace function erp.tg_property_override_guard() returns trigger
  language plpgsql as
$fn$
declare b uuid;
begin
  select id into b from registry_build where is_current;
  if new.field is not null
     and exists (select 1 from registry_field
                  where build_id = b and entity = new.entity
                    and field_name = new.field and is_statutory) then
    raise exception '%.% is a statutory field and may not be overridden', new.entity, new.field
      using errcode = 'ERP71';
  end if;
  return new;
end
$fn$;
create trigger property_override_guard before insert or update on property_override
  for each row execute function erp.tg_property_override_guard();
create trigger property_override_bump after insert or update or delete on property_override
  for each statement execute function erp.tg_bump_overlay_version();

-- Permission overlays MERGE, never replace.  Frappe's source carries
-- "# TODO/XXX: Docperm have no sync as of now. They get OVERRIDDEN on sync",
-- which for statutory roles is a live exposure.  Modelled as additive grant
-- rows with a layer, so a merge is a UNION and a replace is impossible to
-- express.
create table permission_rule (
  id         uuid primary key,
  tenant_id  uuid not null default erp.this_tenant(),
  role       text not null,
  entity     text not null,
  right_name text not null check (right_name in ('read','create','write','submit',
                                                 'cancel','amend','delete','export','print')),
  if_owner   boolean not null default false,
  layer      text not null check (layer in ('core','tenant')),
  -- The NOT NULL scoping set (§3.8).  NULL here means "not constrained on this
  -- axis"; the compiled predicate ANDs the non-null ones.  The columns on the
  -- DATA are NOT NULL, which is what deletes the blank-means-allow footgun.
  company_id     uuid references company(id),
  registration_id uuid references gstin_registration(id),
  cost_center_id uuid references cost_center(id),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint permission_rule_uq
    unique (role, entity, right_name, if_owner, layer,
            company_id, registration_id, cost_center_id)
);
create index permission_rule_lookup_ix on permission_rule (role, entity, right_name);

-- The inspector's source.  "Explain this field" ships in the SAME PR as the
-- overlay: retrofitting observability onto a multi-table merge is what makes
-- these systems undebuggable at year three.
create view v_field_provenance as
  select rf.entity, rf.field_name as field, 'registry'::text as layer,
         null::text as property, to_jsonb(rf.*) as value, 0 as precedence
    from registry_field rf join registry_build rb on rb.id = rf.build_id and rb.is_current
  union all
  select fe.entity, fe.field_key, 'field_extension', null, to_jsonb(fe.*), 1
    from field_extension fe
  union all
  select po.entity, po.field, 'override:' || po.layer, po.property, po.value,
         case po.layer when 'core' then 2 when 'tenant' then 3 end
    from property_override po;

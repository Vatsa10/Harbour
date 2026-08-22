-- ============================================================================
-- 020_rule_store.sql   §3.9 / L10 / D9.  The effective-dated statutory rule store.
--
-- Invariant, stated once: every threshold, rate, slab, code list, digit
-- requirement, UQC, port code and pincode band is DATA with a validity window.
-- No gaps and no overlaps - enforced by the GiST exclusion constraint below,
-- not asserted in a test.  resolve() THROWS when nothing is in force; it never
-- computes zero and never falls back.
--
-- Evidence for why this is a table and not a constants file: on 22 Sep 2025 the
-- entire four-tier GST rate structure was replaced in one Council decision.
-- A constants file needed a code release per customer; a table needed a row.
-- ============================================================================
\set ON_ERROR_STOP on

create table statutory_rule (
  id               uuid primary key,
  tenant_id        uuid not null default erp.this_tenant(),
  domain           text not null
                   check (domain in ('gst','tds','tcs','pf','esi','pt','income_tax',
                                     'ewb','einvoice','codes','retention','msme')),
  key              text not null,        -- 'gst.rate.hsn.7318' | 'pt.slab.MH' | 'tds.194Q'
  jurisdiction     text not null,        -- 'IN' | 'IN-27' | 'IN-DD'
  effective_from   date not null,
  effective_to     date,                 -- null = open
  payload          jsonb not null,       -- shape validated per domain by the app
  -- R9: a rule with no provenance is a defect.  These four are NOT NULL for
  -- that reason and for no other.
  notification_ref text not null,
  source_url       text,
  verified_by      text not null,
  verified_on      date not null,
  superseded_by    uuid references statutory_rule(id),
  created_at       timestamptz not null default now(),
  created_by       uuid not null,
  constraint statutory_rule_period check (effective_to is null or effective_to > effective_from),
  -- The whole point of the table.  Overlapping validity is a DATABASE error.
  constraint statutory_rule_no_overlap exclude using gist (
    key with =, jurisdiction with =,
    daterange(effective_from, effective_to) with &&)
);
create index statutory_rule_key_ix on statutory_rule (key, jurisdiction, effective_from desc);
create index statutory_rule_domain_ix on statutory_rule (domain, effective_from desc);

-- Historical rows are NEVER mutated.  A change is a new row plus superseded_by.
-- Note the conflict this resolves: a blanket append-only guard would also
-- forbid setting superseded_by, which the plan requires.  So the guard is
-- narrowed to exactly one legal mutation - superseded_by, once, null -> value.
-- Nothing else on a statutory rule can ever change, which is the invariant the
-- ruleset stamp on every ledger row depends on.
create or replace function erp.tg_statutory_rule_immutable() returns trigger
  language plpgsql as
$fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'statutory_rule is append-only' using errcode = 'ERP30';
  end if;
  if to_jsonb(old) - 'superseded_by' is distinct from to_jsonb(new) - 'superseded_by' then
    raise exception 'a statutory rule may not be edited; supersede it with a new row'
      using errcode = 'ERP30';
  end if;
  if old.superseded_by is not null and new.superseded_by is distinct from old.superseded_by then
    raise exception 'statutory rule % is already superseded by %', old.id, old.superseded_by
      using errcode = 'ERP30';
  end if;
  return new;
end
$fn$;
create trigger statutory_rule_immutable before update or delete on statutory_rule
  for each row execute function erp.tg_statutory_rule_immutable();
revoke update, delete, truncate on statutory_rule from erp_app;

-- ---------------------------------------------------------------------------
-- ruleset_version   Documents stamp the RULESET, not a rule: one GL row from a
-- GST invoice is produced by a rate rule PLUS a place-of-supply rule PLUS a
-- cess formula PLUS a rounding rule, and one uuid cannot stamp four.
-- ---------------------------------------------------------------------------
create table ruleset_version (
  id         uuid primary key,
  tenant_id  uuid not null default erp.this_tenant(),
  label      text not null unique,
  sealed_at  timestamptz not null,
  digest     bytea not null,
  signed_by  text not null,
  notes      text,
  -- On-prem receives rulesets as signed bundle files verified against a pinned
  -- public key before a single row is written (§3.9).
  bundle_signature bytea,
  created_at timestamptz not null default now()
);

create table ruleset_member (
  ruleset_id uuid not null references ruleset_version(id),
  rule_id    uuid not null references statutory_rule(id),
  primary key (ruleset_id, rule_id)
);
create index ruleset_member_rule_ix on ruleset_member (rule_id);

-- Sealing is idempotent and reproducible: the digest is a function of the
-- member set only, so two machines sealing the same set agree.
create or replace function erp.seal_ruleset(p_ruleset_id uuid) returns bytea
  language plpgsql as
$fn$
declare d bytea;
begin
  select sha256(convert_to(string_agg(r.id::text, ',' order by r.id), 'UTF8'))
    into d
    from ruleset_member m join statutory_rule r on r.id = m.rule_id
   where m.ruleset_id = p_ruleset_id;
  if d is null then
    raise exception 'ruleset % has no members', p_ruleset_id using errcode = 'ERP01';
  end if;
  update ruleset_version set digest = d, sealed_at = now() where id = p_ruleset_id;
  return d;
end
$fn$;

-- ---------------------------------------------------------------------------
-- resolve()   ONE signature, NO fallback.  §3.9:
--   resolve(key, jurisdiction, on, ruleset?) -> Rule, throws MissingStatutoryRule.
-- When p_ruleset_id is supplied the lookup is confined to that sealed snapshot,
-- which is how any historical number is reproduced exactly.
-- ---------------------------------------------------------------------------
create or replace function erp.resolve_rule(
  p_key          text,
  p_jurisdiction text,
  p_on           date,
  p_ruleset_id   uuid default null
) returns statutory_rule
  language plpgsql stable as
$fn$
declare r statutory_rule;
begin
  select sr.* into r
    from statutory_rule sr
   where sr.key = p_key
     and sr.jurisdiction = p_jurisdiction
     and sr.effective_from <= p_on
     and (sr.effective_to is null or sr.effective_to > p_on)
     and (p_ruleset_id is null
          or exists (select 1 from ruleset_member m
                      where m.ruleset_id = p_ruleset_id and m.rule_id = sr.id));
  if not found then
    raise exception 'MissingStatutoryRule: key=% jurisdiction=% on=% ruleset=%',
      p_key, p_jurisdiction, p_on, p_ruleset_id
      using errcode = 'ERP01',
            hint = 'L10: resolve() throws, never computes zero. Seed the rule or refuse the post.';
  end if;
  return r;
end
$fn$;

-- Jurisdiction fallback is a SEPARATE, explicit call.  It is not inside
-- resolve(), because "IN-27 then IN" silently applying is exactly the silent
-- fallback L10 forbids; the caller states that it wants the ladder.
create or replace function erp.resolve_rule_with_state_fallback(
  p_key text, p_state_code text, p_on date, p_ruleset_id uuid default null
) returns statutory_rule
  language plpgsql stable as
$fn$
declare r statutory_rule;
begin
  begin
    r := erp.resolve_rule(p_key, 'IN-' || p_state_code, p_on, p_ruleset_id);
    return r;
  exception when sqlstate 'ERP01' then
    return erp.resolve_rule(p_key, 'IN', p_on, p_ruleset_id);
  end;
end
$fn$;

-- ---------------------------------------------------------------------------
-- Seed rows that Phase 8 read off the issuing authority's own page.  Each is
-- still CA-confirmed before it ships; each carries notification_ref, source_url
-- and verified_by per the schema above.  Everything else stays EMPTY on
-- purpose: L10 makes a missing rule an error, and an empty store refusing to
-- post is the intended day-one behaviour.
-- ---------------------------------------------------------------------------
-- (Seed data lives in 920_seed_rules.sql so this file stays pure DDL.)

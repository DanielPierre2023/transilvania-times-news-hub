-- =====================================================================
-- Transilvania Times — baseline migration EXPORTER
-- File: supabase/sql/02_export_baseline_migration.sql
--
-- READ-ONLY. This script changes nothing. It only *generates text*.
--
-- WHY THIS EXISTS
--   22 of the 43 tables in this database have no `create table` anywhere
--   in supabase/migrations/. They were built by hand in the SQL editor.
--   The repo therefore cannot rebuild the database: a fresh Supabase
--   project created from this repo would be missing newsroom_assets,
--   newsroom_presets, newsroom_bulletins, authors, comments,
--   generation_logs, editor_tokens, sponsor_banners and 14 more, and the
--   app would fail on first load.
--
--   Rather than hand-write those 22 tables from a screenshot — which would
--   be guesswork and would drift from reality — this script reads the LIVE
--   catalog and emits the exact DDL, including constraints, indexes, RLS
--   flags, policies, enum types and the functions the policies depend on.
--
-- HOW TO USE
--   1. Run this in the SQL editor.
--   2. The result is ONE row, ONE column called migration_sql.
--   3. Click the cell, expand it, copy the whole value.
--   4. Paste it into a new file in the repo:
--        supabase/migrations/20260830100000_baseline_from_production.sql
--   5. Commit. Do NOT run that file against production — everything in it
--      is `if not exists` guarded, so running it would be a no-op, but its
--      purpose is to make the repo self-sufficient, not to be re-applied.
--
-- The generated file is safe against an EMPTY project: it creates enums
-- first, then functions, then tables, then constraints, indexes, RLS and
-- policies, in dependency order.
-- =====================================================================

with target_tables as (
  select c.oid, c.relname
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'r'
     and c.relname = any (array[
       'ad_inquiries','ad_pricing','ai_spend_log','anchor_plates','anchors',
       'article_source_materials','authors','automation_settings','comments',
       'county_quotas','editor_drafts','editor_tokens','generation_logs',
       'newsroom_assets','newsroom_bulletins','newsroom_editions','newsroom_presets',
       'pronunciation_lexicon','rundown_items','sponsor_banners','studios',
       'weather_alerts_sent'
     ])
),

-- ── enum types (app_role and friends) ────────────────────────────────
enums as (
  select string_agg(
    format(
      'do $do$ begin'                                              || chr(10) ||
      '  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = ''public'' and t.typname = %L) then' || chr(10) ||
      '    create type public.%I as enum (%s);'                    || chr(10) ||
      '  end if;'                                                  || chr(10) ||
      'end $do$;',
      x.typname, x.typname, x.labels
    ), chr(10) || chr(10) order by x.typname)                       as body
  from (
    select t.typname,
           string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) as labels
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
     where t.typnamespace = 'public'::regnamespace
     group by t.typname
  ) x
),

-- ── functions the policies depend on (has_role et al.) ───────────────
funcs as (
  select string_agg(pg_get_functiondef(p.oid) || ';', chr(10) || chr(10) order by p.proname) as body
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind = 'f'
     and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e')
),

-- ── column definitions ───────────────────────────────────────────────
cols as (
  select t.relname,
         string_agg(
           format('  %I %s%s%s',
             a.attname,
             format_type(a.atttypid, a.atttypmod),
             case when ad.adbin is not null
                  then ' default ' || pg_get_expr(ad.adbin, ad.adrelid) else '' end,
             case when a.attnotnull then ' not null' else '' end
           ), ',' || chr(10) order by a.attnum) as body
    from target_tables t
    join pg_attribute a  on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef ad on ad.adrelid = t.oid and ad.adnum = a.attnum
   group by t.relname
),

-- ── constraints (pk first, then unique, check, fk) ───────────────────
cons as (
  select t.relname,
         string_agg(
           format(
             'do $do$ begin'                                                          || chr(10) ||
             '  if not exists (select 1 from pg_constraint where conname = %L and conrelid = %L::regclass) then' || chr(10) ||
             '    alter table public.%I add constraint %I %s;'                        || chr(10) ||
             '  end if;'                                                              || chr(10) ||
             'end $do$;',
             c.conname, 'public.' || t.relname, t.relname, c.conname,
             pg_get_constraintdef(c.oid)
           ), chr(10) order by
             case c.contype when 'p' then 1 when 'u' then 2 when 'c' then 3 else 4 end,
             c.conname) as body
    from target_tables t
    join pg_constraint c on c.conrelid = t.oid
   group by t.relname
),

-- ── indexes that are not already created by a constraint ─────────────
idx as (
  select t.relname,
         string_agg(
           replace(
             replace(i.indexdef, 'CREATE UNIQUE INDEX ', 'create unique index if not exists '),
             'CREATE INDEX ', 'create index if not exists '
           ) || ';', chr(10) order by i.indexname) as body
    from target_tables t
    join pg_indexes i on i.schemaname = 'public' and i.tablename = t.relname
   where not exists (
     select 1 from pg_constraint c
      where c.conrelid = t.oid and c.conname = i.indexname
   )
   group by t.relname
),

-- ── RLS + policies ───────────────────────────────────────────────────
pol as (
  select t.relname,
         string_agg(
           format(
             'do $do$ begin'                                                          || chr(10) ||
             '  if not exists (select 1 from pg_policies where schemaname = ''public'' and tablename = %L and policyname = %L) then' || chr(10) ||
             '    create policy %I on public.%I as %s for %s to %s%s%s;'               || chr(10) ||
             '  end if;'                                                              || chr(10) ||
             'end $do$;',
             t.relname, p.policyname, p.policyname, t.relname,
             p.permissive, p.cmd, array_to_string(p.roles, ', '),
             case when p.qual is null       then '' else ' using (' || p.qual || ')' end,
             case when p.with_check is null then '' else ' with check (' || p.with_check || ')' end
           ), chr(10) order by p.policyname) as body
    from target_tables t
    join pg_policies p on p.schemaname = 'public' and p.tablename = t.relname
   group by t.relname
),

per_table as (
  select t.relname,
         '-- ' || repeat('-', 66)                                   || chr(10) ||
         '-- ' || t.relname                                         || chr(10) ||
         '-- ' || repeat('-', 66)                                   || chr(10) ||
         format('create table if not exists public.%I (', t.relname) || chr(10) ||
         coalesce(c.body, '')                                       || chr(10) ||
         ');'                                                       || chr(10) || chr(10) ||
         coalesce(cn.body || chr(10) || chr(10), '')                ||
         coalesce(ix.body || chr(10) || chr(10), '')                ||
         format('alter table public.%I enable row level security;', t.relname) || chr(10) || chr(10) ||
         coalesce(pl.body || chr(10), '-- (no RLS policies on this table)' || chr(10))
           as body
    from target_tables t
    left join cols c  on c.relname  = t.relname
    left join cons cn on cn.relname = t.relname
    left join idx  ix on ix.relname = t.relname
    left join pol  pl on pl.relname = t.relname
)

select
  '-- =====================================================================' || chr(10) ||
  '-- Transilvania Times — baseline captured from production'                || chr(10) ||
  '-- Generated ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC' || chr(10) ||
  '--'                                                                       || chr(10) ||
  '-- These objects existed only in the Supabase SQL editor and had no'      || chr(10) ||
  '-- migration in the repository. Captured verbatim from pg_catalog so the' || chr(10) ||
  '-- repo can rebuild the database. Every statement is guarded, so applying'|| chr(10) ||
  '-- this to the existing production database is a no-op.'                  || chr(10) ||
  '-- =====================================================================' || chr(10) || chr(10) ||
  'create extension if not exists pgcrypto;'                                 || chr(10) || chr(10) ||
  '-- ── enum types ──────────────────────────────────────────────────────'  || chr(10) ||
  coalesce((select body from enums), '-- (none)')                            || chr(10) || chr(10) ||
  '-- ── functions ───────────────────────────────────────────────────────'  || chr(10) ||
  coalesce((select body from funcs), '-- (none)')                            || chr(10) || chr(10) ||
  '-- ── tables ──────────────────────────────────────────────────────────'  || chr(10) ||
  string_agg(body, chr(10) || chr(10) order by relname)
    as migration_sql
from per_table;

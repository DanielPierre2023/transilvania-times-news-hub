-- =====================================================================
-- Transilvania Times — Newsroom v2 PRE-FLIGHT / POST-FLIGHT CHECK
-- File: supabase/sql/00_preflight_check.sql
--
-- READ-ONLY. Changes nothing. Safe to run at any time.
--
-- Run it BEFORE 01_newsroom_upgrade.sql to see the starting state, and
-- AFTER to confirm the upgrade landed. Same query both times.
--
-- WHY IT LOOKS ODD IN ONE PLACE
--   The E_slugs row used to read:
--       (select count(*) filter (where slug is not null) ... )
--   `slug` is a bare column reference, and PostgreSQL resolves those at
--   PARSE/ANALYSE time — for every branch of a UNION ALL, before a single
--   row is read. So while the column was still missing the whole statement
--   died with 42703, which is exactly the condition it was meant to report.
--   A pre-flight check that only runs after the migration is useless.
--
--   to_jsonb(b) ->> 'slug' asks the ROW rather than the catalog. A key that
--   is not there yields NULL instead of raising, so the query plans against
--   any shape of the table — before or after the migration.
--
-- WHAT GOOD LOOKS LIKE
--
--   before 01:                          after 01:
--     C_bulletin_new_cols  NONE           all 8 columns listed
--     D_bulletin_policies  3 policies     5 policies (2 x SELECT is correct:
--                                         one admin, one public-published)
--     E_slugs              0 of N         N of N
--     F_new_indexes        2 pre-existing 6
--
--   A_view_exists / B_view_cols describe YOUR ai_spend_daily view. The
--   upgrade does not touch it; it adds ai_spend_by_function_daily alongside.
-- =====================================================================

select 'A_view_exists' k,
       (select count(*)::text from pg_views
         where schemaname = 'public' and viewname = 'ai_spend_daily') v

union all
select 'B_view_cols',
       coalesce((select string_agg(column_name, ', ' order by ordinal_position)
                   from information_schema.columns
                  where table_schema = 'public' and table_name = 'ai_spend_daily'), '-')

union all
select 'C_bulletin_new_cols',
       coalesce((select string_agg(column_name, ', ' order by column_name)
                   from information_schema.columns
                  where table_schema = 'public'
                    and table_name = 'newsroom_bulletins'
                    and column_name in ('slug','published_at','poster_url','duration_seconds',
                                        'seo','edition','utm_campaign','story_slugs')), 'NONE')

union all
select 'D_bulletin_policies',
       coalesce((select string_agg(policyname || '/' || cmd, ' | ' order by policyname)
                   from pg_policies
                  where schemaname = 'public' and tablename = 'newsroom_bulletins'), '-')

union all
select 'E_slugs',
       (select (count(*) filter (where to_jsonb(b) ->> 'slug' is not null))::text
               || ' of ' || count(*)::text
          from public.newsroom_bulletins b)

union all
select 'F_new_indexes',
       coalesce((select string_agg(indexname, ', ' order by indexname)
                   from pg_indexes
                  where schemaname = 'public'
                    and indexname in ('newsroom_bulletins_slug_key',
                                      'newsroom_bulletins_published_idx',
                                      'newsroom_bulletins_created_idx',
                                      'pronunciation_lexicon_lookup_idx',
                                      'ai_spend_log_occurred_idx',
                                      'ai_spend_log_function_idx')), 'NONE');

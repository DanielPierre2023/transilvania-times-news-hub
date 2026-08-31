-- =====================================================================
-- Transilvania Times — Newsroom v2 upgrade
-- File: supabase/sql/01_newsroom_upgrade.sql
-- Run once in: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- SAFE TO RE-RUN. Every statement is idempotent (IF NOT EXISTS / guarded
-- DO blocks). Nothing is dropped, nothing is rewritten, no data is lost.
--
-- WHAT THIS DOES AND WHY
--
--   1. newsroom_bulletins gains a DELETE policy.
--      Today the table has INSERT / SELECT / UPDATE policies only, so the
--      admin UI can create bulletins but can never remove one. That is why
--      a "Clear Newsroom Bulletins" snippet exists in the SQL editor, and
--      why 7 identical re-composes from 29 Aug are still sitting there.
--
--   2. newsroom_bulletins gains a PUBLIC read policy for published rows.
--      The new /buletin/<slug> page renders server-side with the ANON key,
--      so RLS applies to it. Without this policy the page would render
--      empty for every visitor while looking fine to you (you are admin).
--      The policy exposes ONLY rows explicitly marked status='published'
--      with a published_at timestamp — drafts and rendered-but-unpublished
--      bulletins stay invisible.
--
--   3. Columns needed to publish a bulletin as a real page:
--        slug              stable URL segment           (unique)
--        published_at      publication timestamp        (drives the sitemap)
--        poster_url        thumbnail for OG / VideoObject
--        duration_seconds  required by schema.org VideoObject
--        seo               jsonb payload from tt-social-seo
--        edition           'morning' | 'evening' | null
--        utm_campaign      the campaign id used in every social link
--
--   4. Supporting indexes for the two dead tables now being adopted:
--        pronunciation_lexicon (language, active)  — read on every TTS call
--        ai_spend_log (occurred_at desc)           — written on every paid call
--
--   5. Slug backfill for the 17 bulletins already in the table.
--
--   6. A per-function spend view under a NEW name. See section 5 — your
--      existing public.ai_spend_daily is not touched.
--
-- v2 (30 Aug 2026): fixed 42P16 on ai_spend_daily. The v1 file aborted the
-- whole transaction and applied nothing; this one has been checked statement
-- by statement against the live catalog.
--
-- NOTE ON has_role(): this database gates every newsroom policy on
-- public.has_role(auth.uid(), 'admin'::app_role). The policies below use the
-- exact same expression, so admin access is unchanged.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · COLUMNS
-- ---------------------------------------------------------------------

alter table public.newsroom_bulletins
  add column if not exists slug             text,
  add column if not exists published_at     timestamptz,
  add column if not exists poster_url       text,
  add column if not exists duration_seconds numeric,
  add column if not exists seo              jsonb,
  add column if not exists edition          text,
  add column if not exists utm_campaign     text,
  add column if not exists story_slugs      text[];

comment on column public.newsroom_bulletins.slug is
  'Stable URL segment for /buletin/<slug>. Generated at compose time as buletin-YYYY-MM-DD[-n].';
comment on column public.newsroom_bulletins.published_at is
  'Set when the bulletin is published to the public site. NULL = rendered but not public.';
comment on column public.newsroom_bulletins.seo is
  'Full tt-social-seo payload: per-platform captions, hashtag tiers, keywords, JSON-LD.';
comment on column public.newsroom_bulletins.story_slugs is
  'blog_posts.slug for each story, in the same order as story_titles. Lets the public bulletin page link to the source articles without matching on titles.';
comment on column public.newsroom_bulletins.utm_campaign is
  'Campaign id shared by every social link for this bulletin, e.g. buletin-2026-08-30.';


-- ---------------------------------------------------------------------
-- 2 · SLUG BACKFILL + UNIQUENESS
--     Deterministic and collision-safe: buletin-YYYY-MM-DD for the first
--     bulletin of a day, then -2, -3 ... in created_at order.
-- ---------------------------------------------------------------------

with numbered as (
  select
    id,
    'buletin-' || to_char(created_at at time zone 'Europe/Bucharest', 'YYYY-MM-DD')
      || case
           when row_number() over (
                  partition by (created_at at time zone 'Europe/Bucharest')::date
                  order by created_at
                ) = 1
           then ''
           else '-' || row_number() over (
                  partition by (created_at at time zone 'Europe/Bucharest')::date
                  order by created_at
                )::text
         end as new_slug
  from public.newsroom_bulletins
  where slug is null
)
update public.newsroom_bulletins b
   set slug = n.new_slug
  from numbered n
 where b.id = n.id;

create unique index if not exists newsroom_bulletins_slug_key
  on public.newsroom_bulletins (slug)
  where slug is not null;

create index if not exists newsroom_bulletins_published_idx
  on public.newsroom_bulletins (published_at desc)
  where published_at is not null;

create index if not exists newsroom_bulletins_created_idx
  on public.newsroom_bulletins (created_at desc);


-- ---------------------------------------------------------------------
-- 3 · POLICIES
-- ---------------------------------------------------------------------

-- 3a. Admin DELETE — the missing verb. Without it the archive is append-only.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'newsroom_bulletins'
       and policyname = 'bulletins admin delete'
  ) then
    create policy "bulletins admin delete"
      on public.newsroom_bulletins
      for delete
      to authenticated
      using ( public.has_role(auth.uid(), 'admin'::app_role) );
  end if;
end $$;

-- 3b. Public read of PUBLISHED bulletins only.
--     anon  = site visitors (SSR page, sitemap, feeds)
--     authenticated = logged-in visitors who are not admins
--     Admins keep their existing unrestricted select policy.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'newsroom_bulletins'
       and policyname = 'bulletins public read published'
  ) then
    create policy "bulletins public read published"
      on public.newsroom_bulletins
      for select
      to anon, authenticated
      using ( status = 'published' and published_at is not null );
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 4 · ADOPTED TABLES — indexes only, no schema change
--     pronunciation_lexicon is read by generate-voiceover on every call.
--     ai_spend_log is written by every function that spends money.
--     Both are reached with the SERVICE ROLE, which bypasses RLS, so no
--     policy is required and none is added.
-- ---------------------------------------------------------------------

-- NOTE: pronunciation_lexicon_lookup_idx and ai_spend_log_occurred_idx were
-- found ALREADY PRESENT in this database (created by your earlier snippets).
-- Both statements below are therefore no-ops. Worth knowing: `if not exists`
-- matches on NAME only, so if an existing index of the same name covers
-- different columns, Postgres keeps it and says nothing. On tables of 71 and
-- ~200 rows the difference is unmeasurable, so this is left as-is rather than
-- dropping an index that is not mine.
create index if not exists pronunciation_lexicon_lookup_idx
  on public.pronunciation_lexicon (language, active);

create index if not exists ai_spend_log_occurred_idx
  on public.ai_spend_log (occurred_at desc);

create index if not exists ai_spend_log_function_idx
  on public.ai_spend_log (function_name, occurred_at desc);


-- ---------------------------------------------------------------------
-- 5 · CONVENIENCE VIEW — daily AI spend BY FUNCTION
--
-- CORRECTED 30 Aug 2026 (v2). The first version of this file did
--     create or replace view public.ai_spend_daily ...
-- and failed with:
--     42P16: cannot change name of view column "provider" to "function_name"
--
-- Cause: public.ai_spend_daily ALREADY EXISTS — your own "AI Spend Ledger
-- with Daily Rollup" snippet created it with the columns
--     (day, provider, usd, calls)
-- and CREATE OR REPLACE VIEW may add trailing columns but may never rename
-- or reorder existing ones. Adding function_name in second position is
-- exactly that.
--
-- The Supabase SQL editor runs a script as ONE TRANSACTION, so that single
-- error rolled the entire file back: no columns, no policies, no slugs were
-- applied. Verified afterwards against the live catalog — newsroom_bulletins
-- had none of the new columns and only its original three policies.
--
-- Your view is left exactly as it is. Nothing depends on it (checked via
-- pg_depend: no dependent views), but it is yours, and silently reshaping
-- someone's reporting view to suit a different query is not an upgrade.
--
-- The per-function breakdown lives under its own name instead. It is the
-- reason the spend logging was added at all: ai_spend_daily can tell you
-- that Anthropic cost $0.40 yesterday, but not whether that was the script,
-- the captions or the sectionizer.
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_views
     where schemaname = 'public' and viewname = 'ai_spend_by_function_daily'
  ) then
    execute $v$
      create view public.ai_spend_by_function_daily as
      select
        (occurred_at at time zone 'Europe/Bucharest')::date as day,
        function_name,
        provider,
        model,
        count(*)                    as calls,
        round(sum(usd)::numeric, 4) as usd
      from public.ai_spend_log
      group by 1, 2, 3, 4
    $v$;
    comment on view public.ai_spend_by_function_daily is
      'Daily AI spend broken down by edge function, provider and model. Complements ai_spend_daily, which rolls up by provider only.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 6 · VERIFICATION — run this and read the three rows.
-- ---------------------------------------------------------------------

select 'columns added' as check,
       count(*) filter (where column_name in
         ('slug','published_at','poster_url','duration_seconds','seo','edition','utm_campaign','story_slugs'))::text
         || ' / 8' as result
  from information_schema.columns
 where table_schema = 'public' and table_name = 'newsroom_bulletins'
union all
select 'bulletin policies',
       string_agg(cmd, ', ' order by cmd)
  from pg_policies
 where schemaname = 'public' and tablename = 'newsroom_bulletins'
union all
select 'bulletins with slug',
       count(*) filter (where slug is not null)::text || ' / ' || count(*)::text
  from public.newsroom_bulletins
union all
select 'spend views',
       string_agg(viewname, ', ' order by viewname)
  from pg_views
 where schemaname = 'public' and viewname like 'ai_spend%';

-- =====================================================================
-- Transilvania Times — article social publishing: log + A/B measurement
-- File: supabase/sql/04_article_ab_and_social_posts.sql
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- SAFE TO RE-RUN. Idempotent throughout. Nothing is dropped.
--
-- RUN THIS **BEFORE** deploying the frontend + functions. The /admin/social
-- page writes one row to social_posts per successful publish; PostgREST
-- rejects an insert against a missing table, and the publish would look
-- like it failed even though the post went live. Table first, then commit.
--
-- WHY THIS EXISTS
--   1. There was no record anywhere of what got auto-posted for an article.
--      social_posts closes that: dedupe, an audit trail, and the raw API
--      response kept in `payload` for when a platform later disputes a post.
--   2. tt-social-copy now stamps every outbound link with
--        utm_campaign=article-YYYY-MM-DD-<slug> & utm_content=hookA|hookB
--      exactly like tt-social-seo does for bulletins. The two article-scoped
--      views below are the read side of that loop — the same shape as
--      bulletin_hook_performance / bulletin_hook_winner (03_ab_tracking),
--      filtered to article campaigns so the article report never mixes with
--      bulletin numbers.
--
--   NOTE: the A/B split only fills once utm_content is actually CAPTURED on
--   arrival. That is the frontend half of 03_ab_tracking_and_view.sql
--   (app/api/track-page + PageTracker forwarding utm_content). If that half
--   is not yet live, publishing still works and campaign/source are still
--   recorded — only the hookA-vs-hookB comparison stays empty until it is.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · social_posts — one row per successful (or failed) auto-post
-- ---------------------------------------------------------------------

create extension if not exists pgcrypto;

create table if not exists public.social_posts (
  id           uuid primary key default gen_random_uuid(),
  article_id   uuid references public.blog_posts(id) on delete set null,
  platform     text not null,                      -- facebook | instagram | x | linkedin
  lang         text not null default 'ro',         -- ro | en
  format       text,                               -- square | landscape | story
  status       text not null default 'published',  -- published | failed
  external_id  text,                               -- post id / media id / tweet id / li urn
  permalink    text,                               -- public URL of the post, when known
  campaign     text,                               -- article-YYYY-MM-DD-<slug>
  variant      text,                               -- hookA | hookB
  image_url    text,                               -- the studio-assets card that was posted
  error        text,                               -- failure detail when status='failed'
  payload      jsonb,                              -- raw API response, for audit
  created_at   timestamptz not null default now()
);

comment on table public.social_posts is
  'Audit + dedupe log of one-click social publishes from /admin/social. One row per platform attempt; payload keeps the raw provider response.';

create index if not exists social_posts_article_idx  on public.social_posts (article_id, created_at desc);
create index if not exists social_posts_campaign_idx on public.social_posts (campaign);
create index if not exists social_posts_created_idx   on public.social_posts (created_at desc);

alter table public.social_posts enable row level security;

-- Admin-only, all commands. Mirrors the requireAdmin gate on the edge
-- functions: membership is proven by a row in user_roles, not by a claim in
-- the JWT. service_role bypasses RLS, so the functions can still write.
do $do$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'social_posts'
       and policyname = 'social_posts_admin_all'
  ) then
    create policy social_posts_admin_all on public.social_posts
      as permissive for all to authenticated
      using (
        exists (
          select 1 from public.user_roles ur
           where ur.user_id = auth.uid() and ur.role = 'admin'
        )
      )
      with check (
        exists (
          select 1 from public.user_roles ur
           where ur.user_id = auth.uid() and ur.role = 'admin'
        )
      );
  end if;
end $do$;


-- ---------------------------------------------------------------------
-- 2 · utm_content guard (idempotent; harmless if 03_ab_tracking already ran)
-- ---------------------------------------------------------------------

alter table public.site_analytics
  add column if not exists utm_content text;

create index if not exists site_analytics_campaign_content_idx
  on public.site_analytics (utm_campaign, utm_content, created_at desc)
  where utm_campaign is not null;


-- ---------------------------------------------------------------------
-- 3 · VIEW — article social performance, split by source and variant
--
-- Same definition as bulletin_hook_performance, scoped to article-*
-- campaigns so article numbers never mix with bulletin numbers.
-- ---------------------------------------------------------------------

create or replace view public.article_hook_performance as
select
  a.utm_campaign                          as campaign,
  coalesce(a.utm_source, '(necunoscut)')  as source,
  coalesce(a.utm_content, '(fara varianta)') as variant,
  count(*)                                as visits,
  count(distinct a.visitor_id)            as visitors,
  min(a.created_at)                       as first_visit,
  max(a.created_at)                       as last_visit
from public.site_analytics a
where a.utm_campaign like 'article-%'
  and (a.is_bot is null or a.is_bot = false)
  and a.page_path not like '/admin%'
group by 1, 2, 3;

comment on view public.article_hook_performance is
  'Per-article-campaign social performance split by traffic source and creative variant (utm_content). Article twin of bulletin_hook_performance.';


-- ---------------------------------------------------------------------
-- 4 · VIEW — the one-line hookA vs hookB answer per article campaign
-- ---------------------------------------------------------------------

create or replace view public.article_hook_winner as
with ab as (
  select
    utm_campaign as campaign,
    count(*) filter (where utm_content = 'hookA') as visits_a,
    count(*) filter (where utm_content = 'hookB') as visits_b,
    count(distinct visitor_id) filter (where utm_content = 'hookA') as visitors_a,
    count(distinct visitor_id) filter (where utm_content = 'hookB') as visitors_b
  from public.site_analytics
  where utm_campaign like 'article-%'
    and utm_content in ('hookA', 'hookB')
    and (is_bot is null or is_bot = false)
  group by 1
)
select
  campaign,
  visits_a,
  visits_b,
  visitors_a,
  visitors_b,
  case
    when visits_a + visits_b < 30 then 'esantion prea mic'
    when visits_a > visits_b then 'hookA'
    when visits_b > visits_a then 'hookB'
    else 'egal'
  end as winner,
  case
    when least(visits_a, visits_b) = 0 then null
    else round(
      (greatest(visits_a, visits_b)::numeric
       / nullif(least(visits_a, visits_b), 0) - 1) * 100, 1)
  end as lead_percent
from ab;

comment on view public.article_hook_winner is
  'One row per article campaign: hookA vs hookB. Reports "esantion prea mic" under 30 combined visits rather than declaring a winner on noise.';


-- ---------------------------------------------------------------------
-- 5 · VERIFICATION
-- ---------------------------------------------------------------------

select 'social_posts table' as check,
       (select count(*)::text from information_schema.tables
         where table_schema = 'public' and table_name = 'social_posts') || ' / 1' as result
union all
select 'social_posts RLS policy',
       coalesce(string_agg(policyname, ', '), 'MISSING')
  from pg_policies
 where schemaname = 'public' and tablename = 'social_posts'
union all
select 'utm_content column',
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'site_analytics'
           and column_name = 'utm_content') || ' / 1'
union all
select 'article A/B views',
       coalesce(string_agg(viewname, ', ' order by viewname), 'MISSING')
  from pg_views
 where schemaname = 'public' and viewname like 'article_hook%';

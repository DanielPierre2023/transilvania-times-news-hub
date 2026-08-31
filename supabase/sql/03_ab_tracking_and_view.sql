-- =====================================================================
-- Transilvania Times — social A/B measurement
-- File: supabase/sql/03_ab_tracking_and_view.sql
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- SAFE TO RE-RUN. Idempotent throughout. Nothing is dropped.
--
-- RUN THIS **BEFORE** DEPLOYING THE FRONTEND CHANGES.
-- app/api/track-page/route.ts starts sending utm_content with every
-- pageview. PostgREST rejects an insert containing an unknown column, so
-- if the column is missing you do not merely lose the attribution — you
-- lose the ENTIRE pageview. Column first, then the commit.
--
-- WHY THIS EXISTS
--
-- tt-social-seo already stamps every social link with
--     utm_campaign=buletin-YYYY-MM-DD & utm_content=hookA|hookB
-- so the two headline variants can be compared. But site_analytics has
-- no utm_content column, PageTracker never read the parameter, and the
-- API route never forwarded it. The A/B was WRITTEN on every link and
-- then thrown away on arrival — measurable in principle, measured
-- nowhere. This closes that loop.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · COLUMN
-- ---------------------------------------------------------------------

alter table public.site_analytics
  add column if not exists utm_content text;

comment on column public.site_analytics.utm_content is
  'Creative variant from the inbound link. tt-social-seo sets hookA / hookB so the two headline variants of a bulletin can be compared; also carries "bio", "thread" and "desc" for the placements that have no A/B.';

-- Partial: campaign traffic is a small slice of all pageviews, and this
-- keeps the index to that slice instead of indexing every organic hit.
create index if not exists site_analytics_campaign_content_idx
  on public.site_analytics (utm_campaign, utm_content, created_at desc)
  where utm_campaign is not null;


-- ---------------------------------------------------------------------
-- 2 · VIEW — which hook actually won
--
-- One row per campaign x source x variant. Deliberately simple: visits
-- and unique visitors, no engineered "engagement score" that would need
-- explaining before it could be trusted.
--
-- Bots and admin paths are excluded on the same terms as
-- get_analytics_data(), so the numbers here reconcile with the analytics
-- page rather than quietly disagreeing with it.
-- ---------------------------------------------------------------------

create or replace view public.bulletin_hook_performance as
select
  a.utm_campaign                                as campaign,
  coalesce(a.utm_source, '(necunoscut)')        as source,
  coalesce(a.utm_content, '(fara varianta)')    as variant,
  count(*)                                      as visits,
  count(distinct a.visitor_id)                  as visitors,
  min(a.created_at)                             as first_visit,
  max(a.created_at)                             as last_visit
from public.site_analytics a
where a.utm_campaign is not null
  and (a.is_bot is null or a.is_bot = false)
  and a.page_path not like '/admin%'
group by 1, 2, 3;

comment on view public.bulletin_hook_performance is
  'Per-campaign social performance split by traffic source and creative variant (utm_content). Use it to decide which hook style earns clicks, then feed that back into tt-social-seo.';


-- ---------------------------------------------------------------------
-- 3 · VIEW — the one-line answer per campaign
--
-- The A/B question is "which of the two hooks won, and by how much".
-- This answers exactly that and nothing else.
-- ---------------------------------------------------------------------

create or replace view public.bulletin_hook_winner as
with ab as (
  select
    utm_campaign as campaign,
    count(*) filter (where utm_content = 'hookA') as visits_a,
    count(*) filter (where utm_content = 'hookB') as visits_b,
    count(distinct visitor_id) filter (where utm_content = 'hookA') as visitors_a,
    count(distinct visitor_id) filter (where utm_content = 'hookB') as visitors_b
  from public.site_analytics
  where utm_campaign is not null
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

comment on view public.bulletin_hook_winner is
  'One row per bulletin campaign: hookA vs hookB. Reports "esantion prea mic" under 30 combined visits rather than declaring a winner on noise.';


-- ---------------------------------------------------------------------
-- 4 · VERIFICATION
-- ---------------------------------------------------------------------

select 'utm_content column' as check,
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'site_analytics'
           and column_name = 'utm_content') || ' / 1' as result
union all
select 'A/B views',
       string_agg(viewname, ', ' order by viewname)
  from pg_views
 where schemaname = 'public' and viewname like 'bulletin_hook%'
union all
select 'campaign index',
       coalesce(string_agg(indexname, ', '), 'MISSING')
  from pg_indexes
 where schemaname = 'public' and indexname = 'site_analytics_campaign_content_idx';

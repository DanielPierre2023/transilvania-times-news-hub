-- Studio: brand kits.
--
-- WHY THIS EXISTS
--
-- A Studio film had exactly one piece of typography in it — the subtitle — and
-- no rules at all. Nothing stopped a project rendering with the wrong red, the
-- wrong face, captions underneath TikTok's own caption block, or a −16 LUFS
-- social mix sent to a broadcaster who asked for −23. A brand kit answers those
-- once, for every film, instead of being remembered each time.
--
-- TWO PLACES, ON PURPOSE
--
--   studio_brand_kits          the library. Edit here and new films pick it up.
--   studio_projects.brand_kit  a COPY, taken when the project uses it.
--
-- The copy is the point. A film that was approved in March must still render in
-- March's brand when someone re-renders it in September, and it would not if it
-- read a row somebody has since edited. Same reasoning as the immutable version
-- snapshots: what was approved stays exactly as it was approved.

-- ---------------------------------------------------------------------------
-- 1. The library
-- ---------------------------------------------------------------------------

create table if not exists public.studio_brand_kits (
  id          text primary key,
  name        text not null,
  kit         jsonb not null,
  is_default  boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.studio_brand_kits is
  'Reusable brand kits: colour, type scale, logo, house grade, delivery loudness and safe area. lib/brand/kit.ts holds the shape and the defaults.';
comment on column public.studio_brand_kits.kit is
  'A complete BrandKit document. Partial rows are filled against the house default by resolveKit() on read, so adding a field never breaks an existing row.';

-- Only one default. A partial unique index is the honest way to say that.
create unique index if not exists studio_brand_kits_one_default
  on public.studio_brand_kits (is_default) where is_default;

create or replace function public.studio_brand_kits_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists studio_brand_kits_touch on public.studio_brand_kits;
create trigger studio_brand_kits_touch
  before update on public.studio_brand_kits
  for each row execute function public.studio_brand_kits_touch();

-- ---------------------------------------------------------------------------
-- 2. The copy that travels with the project
-- ---------------------------------------------------------------------------

alter table public.studio_projects
  add column if not exists brand_kit_id text references public.studio_brand_kits (id) on delete set null,
  add column if not exists brand_kit    jsonb;

comment on column public.studio_projects.brand_kit is
  'The kit as it was when this project last adopted it. Authoritative for rendering; brand_kit_id only records where it came from.';

-- Versions already snapshot the whole timeline; the kit copy rides along in it.

-- ---------------------------------------------------------------------------
-- 3. Access — same admin gate as the rest of Studio
-- ---------------------------------------------------------------------------

alter table public.studio_brand_kits enable row level security;

drop policy if exists "Admins manage brand kits" on public.studio_brand_kits;
create policy "Admins manage brand kits"
  on public.studio_brand_kits
  for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 4. Seed the house kit
--
-- Values match lib/brand/kit.ts TT_KIT. If they ever disagree, the code wins:
-- resolveKit() fills anything missing, so a stale row degrades to the default
-- rather than to something broken.
-- ---------------------------------------------------------------------------

insert into public.studio_brand_kits (id, name, kit, is_default)
values (
  'tt',
  'Transilvania Times',
  jsonb_build_object(
    'version', 1,
    'id', 'tt',
    'name', 'Transilvania Times',
    'colour', jsonb_build_object(
      'ink', '#14110E', 'paper', '#F4F0E8', 'accent', '#CA2222',
      'onAccent', '#FFFFFF', 'overPicture', '#FFFFFF', 'scrim', 'rgba(12,10,8,0.55)'
    ),
    'type', jsonb_build_object(
      'displayFamily', 'Playfair Display, Georgia, serif',
      'bodyFamily', 'Inter, Helvetica, Arial, sans-serif',
      'display', 0.115, 'title', 0.075, 'subtitle', 0.040,
      'caption', 0.045, 'kicker', 0.024,
      'displayWeight', 700, 'bodyWeight', 600, 'lineHeight', 1.14
    ),
    'grade', jsonb_build_object('look', 'warm', 'strength', 0.85),
    'loudness', 'social',
    'safeArea', 'reels',
    'ruleWeight', 0.006,
    'lowerThirdSeconds', 4
  ),
  true
)
on conflict (id) do nothing;

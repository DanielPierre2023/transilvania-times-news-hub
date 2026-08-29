-- Studio: project versions and the timeline document.
--
-- WHY THIS EXISTS
--
-- 1. studio_projects was created by hand in the dashboard and exists in no
--    migration. A fresh environment could not be built from this repo, and a
--    technical review of the project finds that immediately. This file adopts
--    the existing table: every statement is idempotent, so running it against
--    the live database changes nothing that is already correct.
--
-- 2. A project was one row, overwritten on every save. The previous version
--    simply stopped existing. A production workflow needs the opposite:
--    versions are immutable, and the one that was approved stays exactly as it
--    was approved. That is what studio_project_versions is for.
--
-- 3. Projects are moving from the old scene list to a frame-accurate timeline
--    (lib/timeline). Both shapes are stored side by side during the transition:
--    `data` keeps the legacy scene list, `timeline` holds the new document, and
--    `schema_version` says which one is authoritative. Nothing is converted
--    destructively and no existing project breaks.

-- ---------------------------------------------------------------------------
-- 1. The project row (adopts the table that already exists)
-- ---------------------------------------------------------------------------

create table if not exists public.studio_projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.studio_projects
  add column if not exists timeline       jsonb,
  add column if not exists schema_version integer not null default 0,
  add column if not exists created_by     uuid references auth.users (id) on delete set null,
  add column if not exists archived_at    timestamptz;

comment on column public.studio_projects.data is
  'Legacy scene-list project. Authoritative while schema_version = 0.';
comment on column public.studio_projects.timeline is
  'Frame-accurate timeline document (lib/timeline). Authoritative when schema_version = 1.';
comment on column public.studio_projects.schema_version is
  '0 = legacy scene list in data; 1 = timeline document in timeline.';

create index if not exists studio_projects_updated_at_idx
  on public.studio_projects (updated_at desc);

create index if not exists studio_projects_active_idx
  on public.studio_projects (updated_at desc)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- 2. Immutable versions
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'studio_version_state') then
    create type public.studio_version_state as enum ('draft', 'review', 'approved', 'rejected');
  end if;
end
$$;

create table if not exists public.studio_project_versions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.studio_projects (id) on delete cascade,
  version      integer not null,
  timeline     jsonb not null,
  label        text,
  note         text,
  state        public.studio_version_state not null default 'draft',
  -- Rendered output, filled in by the render worker when a version is rendered.
  render_url   text,
  render_spec  jsonb,
  qc_report    jsonb,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  reviewed_by  uuid references auth.users (id) on delete set null,
  reviewed_at  timestamptz,
  unique (project_id, version)
);

comment on table public.studio_project_versions is
  'Immutable snapshots of a Studio project. A row is never edited after insert except to move it through review; the timeline itself is locked by a trigger.';

create index if not exists studio_project_versions_project_idx
  on public.studio_project_versions (project_id, version desc);

create index if not exists studio_project_versions_state_idx
  on public.studio_project_versions (state, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Version numbers are assigned by the database, not by the client
-- ---------------------------------------------------------------------------

create or replace function public.studio_next_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.version is null or new.version = 0 then
    select coalesce(max(v.version), 0) + 1
      into new.version
      from public.studio_project_versions v
     where v.project_id = new.project_id;
  end if;
  return new;
end
$$;

drop trigger if exists studio_project_versions_number on public.studio_project_versions;
create trigger studio_project_versions_number
  before insert on public.studio_project_versions
  for each row execute function public.studio_next_version();

-- ---------------------------------------------------------------------------
-- 4. The timeline in a version can never change
-- ---------------------------------------------------------------------------
-- This is the whole value of a version. Review state may move; the picture may
-- not. Anything else is a new version.

create or replace function public.studio_version_is_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.timeline is distinct from old.timeline
     or new.version is distinct from old.version
     or new.project_id is distinct from old.project_id
     or new.created_at is distinct from old.created_at then
    raise exception
      'studio_project_versions is immutable: create a new version instead of editing version %', old.version
      using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists studio_project_versions_immutable on public.studio_project_versions;
create trigger studio_project_versions_immutable
  before update on public.studio_project_versions
  for each row execute function public.studio_version_is_immutable();

-- ---------------------------------------------------------------------------
-- 5. updated_at maintained by the database
-- ---------------------------------------------------------------------------

create or replace function public.studio_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists studio_projects_touch on public.studio_projects;
create trigger studio_projects_touch
  before update on public.studio_projects
  for each row execute function public.studio_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Access
-- ---------------------------------------------------------------------------
-- Same model as the rest of the admin surface: admins only, through the
-- browser client. Edge functions use the service role and bypass this.

alter table public.studio_projects         enable row level security;
alter table public.studio_project_versions enable row level security;

drop policy if exists "Admins manage studio projects" on public.studio_projects;
create policy "Admins manage studio projects"
  on public.studio_projects
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins read studio versions" on public.studio_project_versions;
create policy "Admins read studio versions"
  on public.studio_project_versions
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins create studio versions" on public.studio_project_versions;
create policy "Admins create studio versions"
  on public.studio_project_versions
  for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

-- Review state may be moved. The immutability trigger still guards the picture.
drop policy if exists "Admins review studio versions" on public.studio_project_versions;
create policy "Admins review studio versions"
  on public.studio_project_versions
  for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Deliberately no delete policy: a version that was approved must remain.

-- ---------------------------------------------------------------------------
-- 7. Convenience view for the project list
-- ---------------------------------------------------------------------------

create or replace view public.studio_project_overview
with (security_invoker = true) as
select
  p.id,
  p.name,
  p.schema_version,
  p.updated_at,
  p.archived_at,
  count(v.id)                                                  as version_count,
  max(v.version)                                               as latest_version,
  max(v.version) filter (where v.state = 'approved')           as approved_version
from public.studio_projects p
left join public.studio_project_versions v on v.project_id = p.id
group by p.id;

comment on view public.studio_project_overview is
  'Project list with version counts. security_invoker means RLS on the base tables still applies.';

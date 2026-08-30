-- Studio: notes against a version, at a timecode.
--
-- WHY
--
-- studio_project_versions already holds immutable snapshots and a
-- draft/review/approved/rejected state machine, and has since last week. What
-- it has never had is the thing review actually consists of: someone saying
-- "the cut at 0:12 is a frame early" against a specific version, and being able
-- to see later that it was addressed.
--
-- Of the sixteen products surveyed this morning only Canva and Frame.io have
-- anything like this. It is the cheapest large advantage available to us,
-- because the hard half — immutable snapshots that cannot be edited after
-- approval — was already built.

create table if not exists public.studio_version_comments (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.studio_project_versions (id) on delete cascade,
  -- Frames from the start of the timeline. Frames, not seconds: the timeline is
  -- frame-accurate and a note that lands between two frames is a note about
  -- neither of them.
  frame       integer not null default 0,
  body        text not null,
  resolved    boolean not null default false,
  author      uuid references auth.users (id) on delete set null,
  author_name text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

comment on table public.studio_version_comments is
  'Timecoded notes against one immutable version. The version they point at can never change, so a note can never end up describing something that is no longer there.';

create index if not exists studio_version_comments_version_idx
  on public.studio_version_comments (version_id, frame);

create index if not exists studio_version_comments_open_idx
  on public.studio_version_comments (version_id) where not resolved;

alter table public.studio_version_comments enable row level security;

drop policy if exists "Admins manage version comments" on public.studio_version_comments;
create policy "Admins manage version comments"
  on public.studio_version_comments
  for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- A version cannot be approved while a note against it is still open.
--
-- This is the rule that makes the workflow mean something. Without it, approval
-- is a button somebody clicks and the notes sit there for ever.
-- ---------------------------------------------------------------------------

create or replace function public.studio_block_approval_with_open_notes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare open_count integer;
begin
  if new.state = 'approved' and coalesce(old.state, 'draft') <> 'approved' then
    select count(*) into open_count
      from public.studio_version_comments c
     where c.version_id = new.id and not c.resolved;
    if open_count > 0 then
      raise exception 'Versiunea are % observații nerezolvate. Rezolvă-le sau respinge versiunea.', open_count
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists studio_versions_block_approval on public.studio_project_versions;
create trigger studio_versions_block_approval
  before update on public.studio_project_versions
  for each row execute function public.studio_block_approval_with_open_notes();

-- ---------------------------------------------------------------------------
-- A view the review screen reads in one query.
-- ---------------------------------------------------------------------------

create or replace view public.studio_version_review
with (security_invoker = true) as
select
  v.id,
  v.project_id,
  v.version,
  v.state,
  v.label,
  v.note,
  v.render_url,
  v.qc_report,
  v.created_at,
  v.reviewed_at,
  coalesce(c.total, 0)              as note_count,
  coalesce(c.open_notes, 0)         as open_notes
from public.studio_project_versions v
left join lateral (
  select count(*) as total, count(*) filter (where not resolved) as open_notes
    from public.studio_version_comments c where c.version_id = v.id
) c on true;

comment on view public.studio_version_review is
  'Versions with their note counts, for the review screen. security_invoker so the caller RLS applies rather than the view owner''s.';

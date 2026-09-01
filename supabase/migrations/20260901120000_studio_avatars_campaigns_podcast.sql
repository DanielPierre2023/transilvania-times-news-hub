-- Studio: avatars, campaigns, podcasts and screen recordings.
--
-- WHY THIS EXISTS
--
-- Four features that all needed somewhere to live, added together because they
-- share one property: each of them is worthless without persistence.
--
--   An AVATAR that is not saved is not an avatar. The Studio could already
--   generate a presenter and lipsync them; what it could not do is generate the
--   SAME presenter twice, because each shot was a fresh prompt. "Ioana" was a
--   description of a kind of person, so two films a month apart had two
--   different women in the same job. The table is the fix: one saved hero
--   photograph that IS the person, plus references for generating new framings.
--
--   A CAMPAIGN is the only loop in this tool that spends money per iteration,
--   and campaigns fail halfway. Per-row job state is what makes a half-spent
--   run resumable without paying twice for the rows that already succeeded.
--
--   A PODCAST EPISODE carries a transcript that took real money to produce and
--   a set of editorial decisions — where the chapters are, which moments make
--   clips. Re-transcribing an hour because a browser tab closed is the kind of
--   waste that makes a tool feel unreliable.
--
--   A SCREEN RECORDING is captured in the browser and has to survive the trip
--   to the render worker.
--
-- SAFE TO RUN TWICE. Every statement is idempotent; no existing table is
-- altered destructively and nothing here touches studio_projects' timeline.

-- ---------------------------------------------------------------------------
-- 1. Avatars
-- ---------------------------------------------------------------------------

create table if not exists public.studio_avatars (
  id             text primary key,
  name           text not null,
  hero_url       text,
  reference_urls jsonb not null default '[]'::jsonb,
  base_prompt    text not null default '',
  voice_id       text,
  voice_provider text,
  look           text not null default 'warm',
  aspect         text not null default '16:9',
  notes          text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.studio_avatars is
  'A person who stays the same person. hero_url is the ONE photograph that is identity-exact: every shot using it is that file, animated. reference_urls condition newly generated framings, which are close but not guaranteed identical — lib/avatars/index.ts states the difference and the interface repeats it.';
comment on column public.studio_avatars.hero_url is
  'The saved still. Identity here is not "consistent", it is identical, because it is the same pixels. The cost is one framing, one outfit, one background.';
comment on column public.studio_avatars.reference_urls is
  'Up to 16 photographs of the same person (gpt-image-1 accepts 16). Under three, a generated framing varies visibly shot to shot.';
comment on column public.studio_avatars.voice_id is
  'The voice this person always speaks with. An avatar with two voices is two people.';

create index if not exists studio_avatars_name on public.studio_avatars (name);

-- ---------------------------------------------------------------------------
-- 2. Campaigns, and the per-row jobs that make one resumable
-- ---------------------------------------------------------------------------

create table if not exists public.studio_campaigns (
  id            text primary key,
  name          text not null,
  template_id   text not null,
  mode          text not null default 'textOnly',
  avatar_id     text references public.studio_avatars (id) on delete set null,
  slot_values   jsonb not null default '{}'::jsonb,
  rows          jsonb not null default '[]'::jsonb,
  estimate_usd  numeric(10,4) not null default 0,
  ceiling_usd   numeric(10,2) not null default 25,
  state         text not null default 'draft',
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.studio_campaigns is
  'One template plus a list of rows. mode is textOnly | spokenName | fullyGenerated — the three differ in cost by orders of magnitude, which is why the estimate and the ceiling are stored beside the run rather than recomputed.';
comment on column public.studio_campaigns.ceiling_usd is
  'The spend ceiling this campaign was started under. Stored so a later change to the default cannot retroactively authorise a run nobody approved.';
comment on column public.studio_campaigns.estimate_usd is
  'What it was estimated to cost when it was approved. Kept for comparison against what it actually did.';

create table if not exists public.studio_campaign_jobs (
  campaign_id  text not null references public.studio_campaigns (id) on delete cascade,
  row_index    integer not null,
  state        text not null default 'pending',
  project_id   text,
  output_url   text,
  cost_usd     numeric(10,4) not null default 0,
  error        text,
  started_at   timestamptz,
  finished_at  timestamptz,
  primary key (campaign_id, row_index)
);

comment on table public.studio_campaign_jobs is
  'One row of the spreadsheet, one film. Per-row state rather than one boolean for the run, because campaigns fail halfway and resuming must re-run exactly the rows that did not finish.';
comment on column public.studio_campaign_jobs.cost_usd is
  'What this row actually cost. Summed, this is the honest answer to "what did that campaign cost", which the estimate is not.';

create index if not exists studio_campaign_jobs_state
  on public.studio_campaign_jobs (campaign_id, state);

-- ---------------------------------------------------------------------------
-- 3. Podcast episodes
-- ---------------------------------------------------------------------------

create table if not exists public.studio_podcasts (
  id            text primary key,
  title         text not null,
  tracks        jsonb not null default '[]'::jsonb,
  offsets       jsonb not null default '{}'::jsonb,
  words         jsonb,
  cuts          jsonb not null default '[]'::jsonb,
  chapters      jsonb not null default '[]'::jsonb,
  clips         jsonb not null default '[]'::jsonb,
  duration_s    numeric(10,3) not null default 0,
  state         text not null default 'draft',
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.studio_podcasts is
  'A recording session: several camera and microphone files, their measured alignment, the transcript, and the editorial decisions taken on it.';
comment on column public.studio_podcasts.tracks is
  'One entry per file: url, kind (camera|mic), speaker label. Two cameras and two microphones is the common case and none of them agree about what time it is.';
comment on column public.studio_podcasts.offsets is
  'Measured alignment per track, in seconds, with the confidence it was measured at. Below the documented threshold the interface asks rather than syncing automatically — an automatic sync that is wrong is worse than none, because nobody re-checks a job the tool said it had done.';
comment on column public.studio_podcasts.words is
  'The stitched word-level transcript, timestamped against the WHOLE recording. Chunk timestamps start again at zero and must be shifted; forgetting that leaves a transcript that reads perfectly and is wrong everywhere after the first ten minutes.';
comment on column public.studio_podcasts.cuts is
  'Silences and lone filler words to remove. Applying these must also retime the transcript, or every caption in the published episode is late.';

-- ---------------------------------------------------------------------------
-- 4. Screen recordings
-- ---------------------------------------------------------------------------

create table if not exists public.studio_screen_recordings (
  id           text primary key,
  name         text not null,
  url          text not null,
  width        integer not null default 0,
  height       integer not null default 0,
  duration_s   numeric(10,3) not null default 0,
  focuses      jsonb not null default '[]'::jsonb,
  dead_air     jsonb not null default '[]'::jsonb,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.studio_screen_recordings is
  'A capture plus the decisions that make it watchable: where to push in, and which stretches are loading rather than content.';
comment on column public.studio_screen_recordings.focuses is
  'Moments worth pushing into. A crop toward a corner is clamped back onto the screen rather than hanging off it, which is where software puts its interesting buttons.';

-- ---------------------------------------------------------------------------
-- 5. Saved templates
--
-- The built-in library lives in code (lib/templates/library.ts) so it can
-- improve for every project at once. This table is for the ones a team writes
-- themselves, which must NOT change under them when the code does.
-- ---------------------------------------------------------------------------

create table if not exists public.studio_templates (
  id          text primary key,
  name        text not null,
  category    text not null default 'general',
  template    jsonb not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.studio_templates is
  'Templates a team authored. The built-in library stays in code so a fix reaches every project; these are stored whole so nobody edits somebody else''s template by deploying.';

-- ---------------------------------------------------------------------------
-- 6. updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.studio_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'studio_avatars', 'studio_campaigns', 'studio_podcasts', 'studio_templates'
  ] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format(
      'create trigger %I_touch before update on public.%I
         for each row execute function public.studio_touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Access — the same admin gate as the rest of Studio
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'studio_avatars', 'studio_campaigns', 'studio_campaign_jobs',
    'studio_podcasts', 'studio_screen_recordings', 'studio_templates'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Admins manage %s" on public.%I', t, t);
    execute format(
      'create policy "Admins manage %s" on public.%I for all
         using (public.has_role(auth.uid(), ''admin''))
         with check (public.has_role(auth.uid(), ''admin''))', t, t);
  end loop;
end $$;

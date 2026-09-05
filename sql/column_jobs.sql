-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — async columnist engine: the job queue.
-- Run once in the Supabase SQL editor. NEW, isolated table — nothing existing is
-- touched. RLS mirrors your admin pattern, public.has_role(auth.uid(),'admin');
-- the worker and the generator use the service role, which bypasses RLS.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.column_jobs (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'queued'
               check (status in ('queued','drafting','revising','translating','done','error')),
  phase        int  not null default 0,
  article_type text not null,
  editor_key   text not null,
  category     text,
  county       text,
  draft_lang   text not null default 'ro' check (draft_lang in ('ro','en')),
  word_count   int  not null default 1200,
  input        jsonb not null,            -- { prompt, ... } — the same body the sync route receives
  draft        text,                      -- working text in draft_lang, updated per phase
  draft_title  text,
  passes       int  not null default 0,
  max_passes   int  not null default 3,
  result       jsonb,                     -- final { title_ro, content_ro, …, title_en, content_en, … }
  attempts     int  not null default 0,
  error        text,
  est_cost     numeric not null default 0,
  claimed_at   timestamptz,               -- worker claim lock (released to null after each phase)
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists column_jobs_worker_idx  on public.column_jobs (status, claimed_at);
create index if not exists column_jobs_created_idx on public.column_jobs (created_at desc);

alter table public.column_jobs enable row level security;

-- Admin-only, mirroring your Studio policies. The service role bypasses RLS, so
-- the worker and the generator's column_phase branch are unaffected by this.
drop policy if exists "Admins manage column jobs" on public.column_jobs;
create policy "Admins manage column jobs"
  on public.column_jobs for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- OPTIONAL — only if you switch the admin UI from polling to Supabase realtime.
-- The delivered UI defaults to a 5-second poll, so this is NOT required.
-- alter publication supabase_realtime add table public.column_jobs;

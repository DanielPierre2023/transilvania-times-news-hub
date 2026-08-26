-- Studio voices — the source of truth for cloned / custom TTS voices.
--
-- WHY THIS EXISTS (root cause of "my cloned voice appears nowhere"):
-- Cloning a voice on a third-party provider (ElevenLabs, fal/MiniMax) and then
-- reading the provider's LIVE listing to remember it is fragile. If the clone
-- lands on a different account, a plan blocks Instant Voice Cloning, or the
-- provider drops it, the voice silently disappears from the app — because the
-- app kept no record of its own. This table is OUR durable record of every
-- voice the Studio created, independent of any provider listing.
--
-- ACCESS MODEL: reached EXCLUSIVELY through edge functions (voice-lab) using the
-- service role, which bypasses RLS. RLS is enabled with NO anon/authenticated
-- policies, so the table is not reachable from the browser with the anon key.

create table if not exists public.studio_voices (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null check (provider in ('minimax', 'elevenlabs')),
  voice_id        text not null,
  name            text not null,
  person_name     text,
  consent_granted boolean not null default false,
  consent_by      text,
  created_by      text,
  preview_url     text,
  language        text,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  unique (provider, voice_id)
);

comment on table public.studio_voices is
  'Source of truth for Studio-created TTS voices (clones), independent of any provider live listing. Service-role access only (via the voice-lab edge function).';

create index if not exists studio_voices_created_at_idx
  on public.studio_voices (created_at desc);

alter table public.studio_voices enable row level security;
-- Intentionally NO policies: only the service role (edge functions) may read or
-- write. The browser never touches this table directly.

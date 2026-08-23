-- ─────────────────────────────────────────────────────────────────────────
-- Airport flight board (Cluj-Napoca / Târgu Mureș / Sibiu)
--
-- Backing store for the public "Zboruri" tool. Rows are written exclusively by
-- the `flights-sync` Edge Function (service role, bypasses RLS) and read
-- publicly (anon) by the Next.js board. No PII — purely public flight schedule
-- and status data.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.airport_flights (
  id              bigint generated always as identity primary key,
  airport         text not null check (airport in ('CLJ','TGM','SBZ')),
  direction       text not null check (direction in ('departure','arrival')),
  flight_date     date not null,
  flight_no       text not null,
  airline         text,
  city            text,               -- destination (departure) or origin (arrival)
  aircraft        text,
  scheduled_time  time not null,      -- local (Europe/Bucharest)
  estimated_time  time,               -- local, when the source publishes it
  status          text not null default 'SCHEDULED',
  status_raw      text,
  is_charter      boolean not null default false,
  source_url      text,
  updated_at      timestamptz not null default now(),

  -- Upsert key: one row per flight per day per airport/direction.
  constraint airport_flights_uniq
    unique (airport, direction, flight_date, flight_no, scheduled_time)
);

comment on table public.airport_flights is
  'Public flight board data for CLJ/TGM/SBZ, populated by the flights-sync edge function.';

create index if not exists airport_flights_lookup_idx
  on public.airport_flights (airport, direction, flight_date, scheduled_time);

create index if not exists airport_flights_date_idx
  on public.airport_flights (flight_date);

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.airport_flights enable row level security;

-- Public, read-only. Writes happen only via the service-role key, which
-- bypasses RLS, so no write policy is defined for anon/authenticated.
drop policy if exists "airport_flights public read" on public.airport_flights;
create policy "airport_flights public read"
  on public.airport_flights
  for select
  to anon, authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────────────────
-- Flight disruptions log (cancellations + major delays).
--
-- Written by the flights-sync Edge Function when it detects a newly cancelled
-- flight or a delay ≥ 60 min. Each (airport, direction, date, flight, time,
-- kind) is recorded once, so the editor brief email fires a single time per
-- disruption. Service-role only — no public read.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.flight_disruptions (
  id             bigint generated always as identity primary key,
  airport        text not null check (airport in ('CLJ','TGM','SBZ')),
  direction      text not null check (direction in ('departure','arrival')),
  flight_date    date not null,
  flight_no      text not null,
  scheduled_time time not null,
  airline        text,
  city           text,
  kind           text not null check (kind in ('CANCELLED','DELAYED')),
  detail         text,
  detected_at    timestamptz not null default now(),

  constraint flight_disruptions_uniq
    unique (airport, direction, flight_date, flight_no, scheduled_time, kind)
);

comment on table public.flight_disruptions is
  'Detected flight cancellations / major delays; source for the editor disruption brief.';

create index if not exists flight_disruptions_detected_idx
  on public.flight_disruptions (detected_at desc);

-- RLS on, no policy → readable/writable only via the service-role key.
alter table public.flight_disruptions enable row level security;

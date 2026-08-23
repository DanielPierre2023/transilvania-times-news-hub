-- Gate and check-in desk, published by the Cluj VisionAir FIDS live board
-- (used with the airport's permission). Null for airports that don't publish them.
-- (Already applied to production via MCP on 2026-08-23; kept for repo history.)
alter table public.airport_flights
  add column if not exists gate text,
  add column if not exists checkin_desk text;

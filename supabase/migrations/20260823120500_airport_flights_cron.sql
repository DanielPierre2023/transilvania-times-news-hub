-- ─────────────────────────────────────────────────────────────────────────
-- Schedule the flights-sync Edge Function every 10 minutes (pg_cron + pg_net).
--
-- PREREQUISITES — run these once in the SQL editor BEFORE applying this file
-- (they store the target URL + shared secret in Vault so they are never
-- committed to the repo). Replace the two placeholder values:
--
--   select vault.create_secret(
--     'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/flights-sync',
--     'flights_sync_url');
--   select vault.create_secret(
--     '<A-LONG-RANDOM-STRING>',           -- same value you set as the
--     'flights_sync_secret');             -- FLIGHTS_SYNC_SECRET function secret
--
-- And set the matching Edge Function secret (CLI):
--   supabase secrets set FLIGHTS_SYNC_SECRET='<A-LONG-RANDOM-STRING>'
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop a previous schedule of the same name before re-creating it.
do $$
begin
  perform cron.unschedule('flights-sync-every-10min');
exception when others then
  null; -- job did not exist yet
end $$;

select cron.schedule(
  'flights-sync-every-10min',
  '*/10 * * * *',
  $cron$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets
                    where name = 'flights_sync_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets
                            where name = 'flights_sync_secret')
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $cron$
);

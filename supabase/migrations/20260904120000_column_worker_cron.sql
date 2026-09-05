-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — schedule tt-column-worker every minute (pg_cron + pg_net).
-- Mirrors your flights-sync migration exactly (Vault-stored URL + secret, so
-- nothing sensitive is committed).
--
-- PREREQUISITES — run these ONCE in the SQL editor BEFORE applying this file.
-- Replace the two placeholder values:
--
--   select vault.create_secret(
--     'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/tt-column-worker',
--     'column_worker_url');
--   select vault.create_secret(
--     '<A-LONG-RANDOM-STRING>',            -- same value you set as the
--     'column_worker_secret');            -- COLUMN_WORKER_SECRET function secret
--
-- And set the matching Edge Function secret in the dashboard:
--   COLUMN_WORKER_SECRET = '<A-LONG-RANDOM-STRING>'
-- Deploy tt-column-worker with "Verify JWT" OFF — it authenticates via that secret.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop a previous schedule of the same name before re-creating it.
do $$
begin
  perform cron.unschedule('tt-column-worker-every-1min');
exception when others then
  null; -- job did not exist yet
end $$;

select cron.schedule(
  'tt-column-worker-every-1min',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets
                    where name = 'column_worker_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
                              where name = 'column_worker_secret')
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $cron$
);

-- Studio: lock the queue functions down, and index what the runner reads.
--
-- FOUND BY TESTING THE LIVE ENVIRONMENT, not by reading the code.
--
-- Probing the deployed database with nothing but the PUBLIC anon key, all four
-- campaign queue functions answered 200/204:
--
--   claim_campaign_job    200
--   finish_campaign_job   204
--   fail_campaign_job     204
--   release_campaign_job  204
--
-- No data was exposed and none could be: the functions are `security invoker`,
-- so they run as the caller, and row level security on studio_campaign_jobs
-- restricts every row to an admin — an anonymous call updates nothing. The
-- damage is bounded to zero.
--
-- It is still wrong. `create function` grants EXECUTE to PUBLIC by default, so
-- the earlier migration's explicit grant to `authenticated` added nothing and
-- hid the fact that anon already had it. Anyone with the anon key — which ships
-- in every page load, by design — could call these as often as they liked.
-- Nothing breaks, and the database does the work of finding zero rows, over and
-- over, for free.
--
-- Defence in depth is the point: RLS is the thing that protects the data, and
-- it should not be the ONLY thing standing between an anonymous caller and a
-- function whose whole job is to mutate a work queue.
--
-- SAFE TO RUN TWICE.

do $$
declare
  fn text;
  sig text;
begin
  foreach sig in array array[
    'public.claim_campaign_job(text, text, integer, integer)',
    'public.finish_campaign_job(text, integer, text, numeric)',
    'public.fail_campaign_job(text, integer, text, timestamptz, boolean, integer)',
    'public.release_campaign_job(text, integer)'
  ] loop
    -- PUBLIC first: revoking from anon alone leaves the PUBLIC grant in place,
    -- and anon inherits it. That is the mistake this migration exists to undo.
    execute format('revoke all on function %s from public', sig);
    begin execute format('revoke all on function %s from anon', sig); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', sig); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to service_role', sig); exception when undefined_object then null; end;
  end loop;
  fn := null;
end $$;

-- ---------------------------------------------------------------------------
-- The index the claim actually uses.
--
-- The earlier index covers (campaign_id, state, not_before). The claim also
-- filters on `attempts < max` and orders by `attempts, row_index`, so on a
-- campaign of five hundred rows Postgres sorts the survivors on every single
-- claim — five hundred times per campaign. Cheap to fix, and the cost only
-- shows up at exactly the size this feature exists for.
-- ---------------------------------------------------------------------------

create index if not exists studio_campaign_jobs_claim_order
  on public.studio_campaign_jobs (campaign_id, attempts, row_index)
  where state <> 'done';

comment on index public.studio_campaign_jobs_claim_order is
  'Matches the claim''s own ORDER BY. Partial on state <> done so finished rows, which are most of a completed campaign, are not carried in it.';

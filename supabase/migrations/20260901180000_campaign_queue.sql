-- Studio: the campaign queue.
--
-- WHY THIS EXISTS
--
-- The campaign page could build and price hundreds of films and refuse to
-- exceed a ceiling. It could not RUN them: somebody had to sit with the tab
-- open. This makes a campaign a queue that survives the tab being closed, the
-- browser crashing, and the machine being shut.
--
-- THE ONE THING THIS FILE IS FOR: NOT RENDERING A ROW TWICE.
--
-- Everything else in the runner is arithmetic and can live in TypeScript. This
-- cannot. The moment two drivers exist — a browser tab and a server poller, or
-- two tabs, or one tab and a retry of a request that did not appear to finish —
-- "find a pending row and mark it running" is a read followed by a write, and
-- two of those interleave happily. Both drivers see the same pending row, both
-- mark it running, both render it, both pay for it, and the second result
-- overwrites the first so NOTHING LOOKS WRONG. The campaign completes, the
-- films are right, and the bill is double.
--
-- The fix is that the read and the write must be one statement. `update ...
-- where state = 'pending' returning *` is atomic: Postgres takes a row lock,
-- and the second caller's `where` no longer matches. That is the whole
-- guarantee, and `52-queue.cjs` proves it by running concurrent claimers
-- against a real database and asserting that no row is ever handed out twice.
--
-- A LEASE, NOT A FLAG. A driver that dies leaves its row 'running' forever. So
-- a claim expires: after `lease_until` the row is claimable again. That is what
-- makes closing the browser safe rather than destructive.
--
-- SAFE TO RUN TWICE.

-- ---------------------------------------------------------------------------
-- 1. What a job needs in order to be claimed rather than just marked
-- ---------------------------------------------------------------------------

alter table public.studio_campaign_jobs
  add column if not exists attempts     integer     not null default 0,
  add column if not exists lease_until  timestamptz,
  add column if not exists not_before   timestamptz,
  add column if not exists claimed_by   text;

comment on column public.studio_campaign_jobs.lease_until is
  'When this claim expires. A driver that dies leaves the row claimable again after this, which is what makes closing the browser safe rather than destructive.';
comment on column public.studio_campaign_jobs.not_before is
  'Backoff. A failed row waits before being retried, with jitter, so four hundred rows failing in the same second do not all retry in the same second.';
comment on column public.studio_campaign_jobs.attempts is
  'Attempts so far. Capped, because a row that can never succeed is otherwise retried for as long as the campaign runs, paying each time.';
comment on column public.studio_campaign_jobs.claimed_by is
  'Which driver holds the claim. Recorded for diagnosis only — correctness comes from the atomic update, never from comparing this.';

create index if not exists studio_campaign_jobs_claimable
  on public.studio_campaign_jobs (campaign_id, state, not_before);

-- ---------------------------------------------------------------------------
-- 2. Campaign-level run state
-- ---------------------------------------------------------------------------

alter table public.studio_campaigns
  add column if not exists run_state     text not null default 'idle',
  add column if not exists spent_usd     numeric(10,4) not null default 0,
  add column if not exists halt_reason   text,
  add column if not exists started_at    timestamptz,
  add column if not exists finished_at   timestamptz;

comment on column public.studio_campaigns.spent_usd is
  'What the campaign has ACTUALLY cost, summed from the rows. The estimate is what somebody approved; this is what happened, and when they disagree it is the estimate that is wrong.';
comment on column public.studio_campaigns.run_state is
  'idle | running | paused | halted | done. A halted campaign has a halt_reason and does not resume on its own.';

-- ---------------------------------------------------------------------------
-- 3. The claim
--
-- One statement. The `where` clause IS the mutual exclusion.
-- ---------------------------------------------------------------------------

create or replace function public.claim_campaign_job(
  p_campaign   text,
  p_driver     text,
  p_lease_ms   integer default 600000,
  p_max_attempts integer default 3
)
returns table (row_index integer, attempts integer)
language sql
volatile
security invoker
as $$
  update public.studio_campaign_jobs j
     set state       = 'running',
         attempts    = j.attempts + 1,
         claimed_by  = p_driver,
         lease_until = now() + make_interval(secs => p_lease_ms / 1000.0),
         started_at  = coalesce(j.started_at, now())
   where (j.campaign_id, j.row_index) = (
     -- The subquery picks ONE row and locks it. `for update skip locked` is
     -- what lets several drivers work the same campaign at once without
     -- queueing behind each other: a driver skips rows another driver has
     -- already locked instead of waiting for them.
     select c.campaign_id, c.row_index
       from public.studio_campaign_jobs c
      where c.campaign_id = p_campaign
        and c.attempts < p_max_attempts
        and (c.not_before is null or c.not_before <= now())
        and (
              c.state in ('pending', 'failed')
              -- ...or a claim that has lapsed, which is how work left behind by
              -- a driver that died comes back.
              or (c.state = 'running' and c.lease_until is not null and c.lease_until < now())
            )
      order by c.attempts asc, c.row_index asc
      limit 1
      for update skip locked
   )
  returning j.row_index, j.attempts;
$$;

comment on function public.claim_campaign_job(text, text, integer, integer) is
  'Atomically take one row of a campaign. The read and the write are one statement, so two drivers cannot both take the same row — which would render it twice, pay twice, and look completely normal afterwards.';

-- ---------------------------------------------------------------------------
-- 4. Finishing a row
--
-- Both of these also move the campaign''s own spend, in the same statement, so
-- the total can never disagree with the rows it is made of.
-- ---------------------------------------------------------------------------

create or replace function public.finish_campaign_job(
  p_campaign  text,
  p_row       integer,
  p_url       text,
  p_cost      numeric
)
returns void
language plpgsql
volatile
security invoker
as $$
begin
  update public.studio_campaign_jobs
     set state = 'done', output_url = p_url, cost_usd = p_cost,
         lease_until = null, finished_at = now(), error = null
   where campaign_id = p_campaign and row_index = p_row;

  update public.studio_campaigns c
     set spent_usd = (
           select coalesce(sum(cost_usd), 0)
             from public.studio_campaign_jobs
            where campaign_id = p_campaign)
   where c.id = p_campaign;
end $$;

create or replace function public.fail_campaign_job(
  p_campaign   text,
  p_row        integer,
  p_error      text,
  p_retry_at   timestamptz,
  p_exhaust    boolean,
  p_max_attempts integer default 3
)
returns void
language sql
volatile
security invoker
as $$
  update public.studio_campaign_jobs
     set state       = 'failed',
         error       = p_error,
         lease_until = null,
         not_before  = p_retry_at,
         -- A permanent error burns the remaining attempts immediately rather
         -- than being asked twice more for the same refusal.
         attempts    = case when p_exhaust then p_max_attempts else attempts end,
         finished_at = now()
   where campaign_id = p_campaign and row_index = p_row;
$$;

-- ---------------------------------------------------------------------------
-- 5. Releasing a claim without failing the row
--
-- For a driver shutting down cleanly — a closed tab, a redeploy. Handing the
-- row straight back is better than letting the lease run out, which would leave
-- it idle for ten minutes for no reason.
-- ---------------------------------------------------------------------------

create or replace function public.release_campaign_job(p_campaign text, p_row integer)
returns void
language sql
volatile
security invoker
as $$
  update public.studio_campaign_jobs
     set state = 'pending', lease_until = null,
         -- The attempt is given back too: a clean release is not a failure, and
         -- counting it as one would exhaust a healthy row after three tab
         -- closes.
         attempts = greatest(0, attempts - 1)
   where campaign_id = p_campaign and row_index = p_row and state = 'running';
$$;

-- ---------------------------------------------------------------------------
-- 6. One view of where a campaign stands
-- ---------------------------------------------------------------------------

create or replace view public.studio_campaign_progress as
  select c.id,
         c.name,
         c.run_state,
         c.ceiling_usd,
         c.estimate_usd,
         c.spent_usd,
         count(j.*)                                              as total,
         count(*) filter (where j.state = 'done')                as done,
         count(*) filter (where j.state = 'running')              as running,
         count(*) filter (where j.state = 'failed'
                            and j.attempts >= 3)                  as failed,
         count(*) filter (where j.state = 'pending'
                            or (j.state = 'failed' and j.attempts < 3)) as remaining
    from public.studio_campaigns c
    left join public.studio_campaign_jobs j on j.campaign_id = c.id
   group by c.id;

comment on view public.studio_campaign_progress is
  'One row per campaign: how far it is, and what it has really cost. Counts come from the jobs so the two can never disagree.';

-- ---------------------------------------------------------------------------
-- 7. Access
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'grant execute on function public.claim_campaign_job(text, text, integer, integer) to authenticated';
  execute 'grant execute on function public.finish_campaign_job(text, integer, text, numeric) to authenticated';
  execute 'grant execute on function public.fail_campaign_job(text, integer, text, timestamptz, boolean, integer) to authenticated';
  execute 'grant execute on function public.release_campaign_job(text, integer) to authenticated';
exception when undefined_object then
  -- A local Postgres used for testing has no `authenticated` role. The grant is
  -- meaningless there and its absence must not stop the migration.
  null;
end $$;

-- Studio: a row carries its own timeline, and the tenancy this needs to be sold.
--
-- PART ONE — WHY A JOB CARRIES ITS TIMELINE.
--
-- The campaign runner builds each row's timeline in the browser and renders it
-- there. Moving that loop onto the Railway worker looked like it meant teaching
-- the worker to build timelines: brand kits, caption placement, transitions,
-- speed ramps — the whole of lib/timeline/project.ts, reimplemented server-side
-- or shipped there. Either way TWO builders, and two answers to "how long is
-- this film" within a week.
--
-- The cheaper and stricter answer is that the timeline is BUILT ONCE, when the
-- campaign is created, and stored on the row. After that a driver — a browser
-- tab, a worker poller, anything — only has to render a document that already
-- exists. The films a poller makes are then byte-identical to the ones the tab
-- makes, not because both builders agree but because there is one document.
--
-- It also makes a campaign inspectable. A row that produced a wrong film can be
-- read: the exact timeline is on it.
--
-- PART TWO — TENANCY.
--
-- Everything in this Studio is gated on `has_role(auth.uid(), 'admin')`, which
-- is exactly right for one newsroom and useless the moment a second company
-- uses it. Rows have no owner, so there is nothing to scope a query BY. This
-- adds the owner, and it adds it in the one way that cannot be got wrong later:
-- a nullable `org_id` with policies that keep working when it is null. Existing
-- rows stay visible to existing admins; new rows can belong to an org. Nothing
-- is migrated, nothing breaks, and the column is there to build on.
--
-- SAFE TO RUN TWICE.

-- ---------------------------------------------------------------------------
-- 1. The timeline, on the row
-- ---------------------------------------------------------------------------

alter table public.studio_campaign_jobs
  add column if not exists timeline jsonb,
  add column if not exists render_job_id text;

comment on column public.studio_campaign_jobs.timeline is
  'The finished timeline for this row, built once when the campaign was created. A driver renders a document that already exists rather than building one, so a browser tab and a server poller produce the same film by construction rather than by agreement.';
comment on column public.studio_campaign_jobs.render_job_id is
  'The worker job currently rendering this row. Lets a driver that restarts pick up a render already in flight instead of paying for it twice.';

-- ---------------------------------------------------------------------------
-- 2. Organisations, seats and API keys
-- ---------------------------------------------------------------------------

create table if not exists public.studio_orgs (
  id          text primary key,
  name        text not null,
  plan        text not null default 'trial',
  /** Hard ceiling per calendar month. Enforced in SQL, not in a button. */
  monthly_usd numeric(10,2) not null default 50,
  seats       integer not null default 3,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.studio_orgs is
  'One customer. `monthly_usd` is a hard ceiling checked by studio_org_can_spend() before work starts, not a figure on an invoice afterwards.';

create table if not exists public.studio_org_members (
  org_id   text not null references public.studio_orgs (id) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  role     text not null default 'member',
  added_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

comment on table public.studio_org_members is
  'Seats. role is owner | admin | member. The primary key is what stops the same person occupying two seats in one org, which is how seat counts drift.';

create table if not exists public.studio_api_keys (
  id          text primary key,
  org_id      text not null references public.studio_orgs (id) on delete cascade,
  name        text not null,
  /** SHA-256 of the key. The key itself is shown once and never stored. */
  key_hash    text not null unique,
  /** First 8 characters, so a key can be identified in a list without storing it. */
  key_prefix  text not null,
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.studio_api_keys is
  'Public API access. Only a hash is stored: a table of live keys is a breach waiting for a backup to leak, and there is no legitimate reason to be able to read a customer''s key back.';
comment on column public.studio_api_keys.key_prefix is
  'The first characters, for identifying a key in a list. Not enough to authenticate with.';

-- ---------------------------------------------------------------------------
-- 3. Metering
--
-- One row per chargeable thing that happened. Never derived from a counter,
-- because a counter cannot be audited and cannot be re-summed after a bug.
-- ---------------------------------------------------------------------------

create table if not exists public.studio_usage (
  id          bigserial primary key,
  org_id      text references public.studio_orgs (id) on delete set null,
  user_id     uuid references auth.users (id) on delete set null,
  /** image | motion | voice | lipsync | render | transcribe */
  kind        text not null,
  units       numeric(12,4) not null default 1,
  usd         numeric(10,4) not null default 0,
  campaign_id text,
  row_index   integer,
  at          timestamptz not null default now(),
  meta        jsonb
);

comment on table public.studio_usage is
  'One row per chargeable event, with what it cost. An append-only ledger rather than a counter: a counter cannot be audited, cannot be re-summed after a pricing bug, and cannot answer "what did that campaign actually cost".';

create index if not exists studio_usage_org_month
  on public.studio_usage (org_id, at desc);
create index if not exists studio_usage_campaign
  on public.studio_usage (campaign_id, row_index);

-- Owner columns, nullable so nothing existing breaks.
alter table public.studio_campaigns  add column if not exists org_id text references public.studio_orgs (id) on delete set null;
alter table public.studio_avatars    add column if not exists org_id text references public.studio_orgs (id) on delete set null;
alter table public.studio_podcasts   add column if not exists org_id text references public.studio_orgs (id) on delete set null;
alter table public.studio_templates  add column if not exists org_id text references public.studio_orgs (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. The spend gate
--
-- A ceiling that is only enforced in the interface is a suggestion. This is the
-- same reasoning as the campaign runner's own gate being a pure function rather
-- than button state, one layer further down.
-- ---------------------------------------------------------------------------

create or replace function public.studio_org_month_usd(p_org text)
returns numeric
language sql
stable
as $$
  select coalesce(sum(usd), 0)
    from public.studio_usage
   where org_id = p_org
     and at >= date_trunc('month', now());
$$;

comment on function public.studio_org_month_usd(text) is
  'Spend so far this calendar month, summed from the ledger. Not read from a counter, so it survives a pricing correction.';

create or replace function public.studio_org_can_spend(p_org text, p_usd numeric)
returns boolean
language sql
stable
as $$
  select case
    -- No org means single-tenant, which is how this database runs today. The
    -- gate must not start refusing work the moment the column exists.
    when p_org is null then true
    else coalesce((
      select public.studio_org_month_usd(p_org) + coalesce(p_usd, 0) <= o.monthly_usd
        from public.studio_orgs o where o.id = p_org
    ), false)
  end;
$$;

comment on function public.studio_org_can_spend(text, numeric) is
  'Would this spend stay inside the org''s monthly ceiling? Checked BEFORE the work, because a ceiling enforced afterwards is an invoice.';

-- Membership, as a function so policies stay readable.
create or replace function public.studio_in_org(p_org text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is null
      or exists (select 1 from public.studio_org_members m
                  where m.org_id = p_org and m.user_id = auth.uid());
$$;

comment on function public.studio_in_org(text) is
  'True for a member of the org, and true when there is no org — so the policies below keep working on the single-tenant rows that already exist.';

-- ---------------------------------------------------------------------------
-- 5. Access
-- ---------------------------------------------------------------------------

alter table public.studio_orgs        enable row level security;
alter table public.studio_org_members enable row level security;
alter table public.studio_api_keys    enable row level security;
alter table public.studio_usage       enable row level security;

drop policy if exists "Members read their org" on public.studio_orgs;
create policy "Members read their org" on public.studio_orgs for select
  using (public.has_role(auth.uid(), 'admin') or public.studio_in_org(id));

drop policy if exists "Admins manage orgs" on public.studio_orgs;
create policy "Admins manage orgs" on public.studio_orgs for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins manage seats" on public.studio_org_members;
create policy "Admins manage seats" on public.studio_org_members for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Members see their own seat" on public.studio_org_members;
create policy "Members see their own seat" on public.studio_org_members for select
  using (user_id = auth.uid());

-- API keys: administrators only, and never readable as a key — only the hash is
-- stored, so even a full table read yields nothing that can authenticate.
drop policy if exists "Admins manage api keys" on public.studio_api_keys;
create policy "Admins manage api keys" on public.studio_api_keys for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins read usage" on public.studio_usage;
create policy "Admins read usage" on public.studio_usage for select
  using (public.has_role(auth.uid(), 'admin') or public.studio_in_org(org_id));

drop policy if exists "Members write usage" on public.studio_usage;
create policy "Members write usage" on public.studio_usage for insert
  with check (public.has_role(auth.uid(), 'admin') or public.studio_in_org(org_id));

-- The ledger is append-only. An UPDATE or DELETE policy is deliberately absent:
-- a spend record that can be edited is not a record, and the only reason to
-- delete one is to make a bill look different.

revoke all on function public.studio_org_can_spend(text, numeric) from public;
revoke all on function public.studio_org_month_usd(text) from public;
do $$ begin
  grant execute on function public.studio_org_can_spend(text, numeric) to authenticated;
  grant execute on function public.studio_org_month_usd(text) to authenticated;
  grant execute on function public.studio_in_org(text) to authenticated;
exception when undefined_object then null; end $$;

do $$ begin
  execute 'drop trigger if exists studio_orgs_touch on public.studio_orgs';
  execute 'create trigger studio_orgs_touch before update on public.studio_orgs
             for each row execute function public.studio_touch_updated_at()';
end $$;

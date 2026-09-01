// _verification/50-migration.cjs
//
// The migrations are RUN, not read.
//
// Every other kind of code in this repository is executed by something before
// it reaches Daniel: TypeScript compiles, the worker renders, the tests draw
// pixels. SQL was the one exception — it was written, eyeballed, and pasted by
// hand into a production SQL editor, which means a syntax error is discovered
// by the person pasting it, in the live database, with no way back.
//
// So this suite starts a real PostgreSQL, stubs the two Supabase-specific
// things a migration leans on (`auth.uid()` and `has_role`), and runs every
// migration file in order. Then it runs them ALL A SECOND TIME, because these
// get pasted twice more often than anyone admits and "create table" without
// "if not exists" fails the second time.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '']
  .find(d => spawnSync(path.join(d, 'pg_ctl'), ['--version'], { stdio: 'ignore' }).status === 0)
if (BIN === undefined) {
  console.log('  postgres not available — this suite cannot run')
  process.exit(2)
}
const bin = (n) => (BIN ? path.join(BIN, n) : n)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgt-'))
const data = path.join(dir, 'data')
const sock = path.join(dir, 'run')
fs.mkdirSync(sock)
const PORT = 5400 + (process.pid % 150)

// initdb refuses to run as root, so everything runs as the postgres user.
const asPg = (cmd) => spawnSync('su', ['postgres', '-c', cmd], { encoding: 'utf8' })
spawnSync('chown', ['-R', 'postgres', dir])
spawnSync('chmod', ['700', data], { stdio: 'ignore' })

const init = asPg(`${bin('initdb')} -D ${data} -A trust`)
if (init.status !== 0) { console.log('  initdb failed:', (init.stderr || '').slice(0, 300)); process.exit(2) }
spawnSync('chown', ['-R', 'postgres', dir])

const start = asPg(
  `${bin('pg_ctl')} -D ${data} -o "-k ${sock} -p ${PORT} -c listen_addresses=" -l ${dir}/log start`)
if (start.status !== 0) { console.log('  could not start postgres:', (start.stderr || '').slice(0, 300)); process.exit(2) }

const psql = (sqlFile, db = 'postgres') =>
  asPg(`${bin('psql')} -h ${sock} -p ${PORT} -d ${db} -q -v ON_ERROR_STOP=1 -f ${sqlFile}`)
const query = (sql, db = 'postgres') =>
  asPg(`${bin('psql')} -h ${sock} -p ${PORT} -d ${db} -tAq -c ${JSON.stringify(sql)}`)

function stop() {
  asPg(`${bin('pg_ctl')} -D ${data} -m immediate stop`)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
}

try {
  // The pieces of Supabase a migration assumes exist.
  const stub = path.join(dir, 'stub.sql')
  fs.writeFileSync(stub, `
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.has_role(u uuid, r text) returns boolean language sql stable as $$ select true $$;
`)
  fs.chmodSync(stub, 0o644)
  ok('the Supabase stubs apply', psql(stub).status === 0)

  // MIGRATIONS THIS ZIP ADDS. These are the ones being asked to run in a live
  // database, so these are the ones tested. The repository's older migrations
  // are already applied in production and several of them cannot run here at
  // all — they need Supabase's own roles, pg_cron, or tables created by an
  // earlier file under a different name. Testing those would be testing the
  // sandbox, and "fixing" them would be rewriting history that has already run.
  const NEW_MIGRATIONS = fs.readdirSync(MIGRATIONS)
    .filter(f => f.endsWith('.sql') && f >= '20260901')
    .sort()

  ok('this zip adds at least one migration', NEW_MIGRATIONS.length > 0, NEW_MIGRATIONS.join(','))

  // The Studio tables the new migration references must exist first. In the
  // real database they already do; here they are created from their own
  // migration, which is itself worth running.
  const base = fs.readdirSync(MIGRATIONS)
    .filter(f => /studio_(timeline|brand_kits|version_comments|brand_kit_inherit)/.test(f)).sort()
  for (const f of base) psql(path.join(MIGRATIONS, f))

  let firstPassOk = true
  for (const f of NEW_MIGRATIONS) {
    const r = psql(path.join(MIGRATIONS, f))
    if (r.status !== 0) {
      firstPassOk = false
      ok(`${f} APPLIES TO A REAL POSTGRES`, false,
        (r.stderr || r.stdout || '').split('\n').filter(l => /ERROR/.test(l)).slice(0, 2).join(' | '))
    } else pass++
  }
  ok('every migration in this zip applies without an error', firstPassOk)

  // THE SECOND RUN.
  const notIdempotent = []
  for (const f of NEW_MIGRATIONS) {
    const r = psql(path.join(MIGRATIONS, f))
    if (r.status !== 0) notIdempotent.push(f)
  }
  ok('EVERY MIGRATION IN THIS ZIP SURVIVES BEING RUN A SECOND TIME — they are ' +
     'pasted by hand into a SQL editor, and pasted twice more often than ' +
     'anyone admits', notIdempotent.length === 0, notIdempotent.join(', '))

  // The tables this round adds must exist, be protected, and work.
  const NEW = ['studio_avatars', 'studio_campaigns', 'studio_campaign_jobs',
               'studio_podcasts', 'studio_screen_recordings', 'studio_templates']
  const list = (sql) => (query(sql).stdout || '').trim().split('\n').filter(Boolean)

  const tables = list(
    `select table_name from information_schema.tables where table_schema='public' and table_name in (${NEW.map(t => `'${t}'`).join(',')})`)
  ok('every new table is created', tables.length === NEW.length, tables.join(','))

  const rls = list(
    `select tablename from pg_tables where schemaname='public' and rowsecurity and tablename in (${NEW.map(t => `'${t}'`).join(',')})`)
  ok('ROW LEVEL SECURITY IS ON FOR EVERY NEW TABLE — a table without it is ' +
     'readable by anyone with the anon key', rls.length === NEW.length,
    NEW.filter(t => !rls.includes(t)).join(','))

  const pol = list(
    `select tablename from pg_policies where schemaname='public' and tablename in (${NEW.map(t => `'${t}'`).join(',')})`)
  ok('...and every one of them has a policy, or RLS locks it to nobody at all',
    new Set(pol).size === NEW.length, NEW.filter(t => !pol.includes(t)).join(','))

  // Real rows, real behaviour.
  const work = path.join(dir, 'work.sql')
  fs.writeFileSync(work, `
insert into public.studio_avatars (id,name,hero_url,reference_urls,base_prompt,voice_id)
  values ('av1','Ioana','https://x/h.png','["https://x/1.png"]','a presenter','v1');
insert into public.studio_campaigns (id,name,template_id,mode,avatar_id,rows,estimate_usd,ceiling_usd)
  values ('c1','Outreach','sales-outreach','spokenName','av1','[{"prenume":"Ana"}]',4.2,25);
insert into public.studio_campaign_jobs (campaign_id,row_index,state) values ('c1',0,'pending');
insert into public.studio_podcasts (id,title,tracks) values ('p1','Ep 1','[{"url":"a.wav","kind":"mic"}]');
insert into public.studio_screen_recordings (id,name,url,width,height) values ('s1','Demo','u',2560,1440);
insert into public.studio_templates (id,name,template) values ('t1','Mine','{"beats":[]}');
update public.studio_avatars set name='Ioana M' where id='av1';
`)
  fs.chmodSync(work, 0o644)
  ok('a realistic row can be written to every new table', psql(work).status === 0)

  ok('the updated_at trigger really fires on update',
    (query(`select updated_at > created_at from public.studio_avatars where id='av1'`).stdout || '').trim() === 't')

  ok('deleting a campaign CASCADES to its per-row jobs, rather than orphaning ' +
     'them where a resume would find them and re-run finished rows', (() => {
      query(`delete from public.studio_campaigns where id='c1'`)
      return (query(`select count(*) from public.studio_campaign_jobs where campaign_id='c1'`).stdout || '').trim() === '0'
    })())

  ok('an avatar referenced by a campaign can be deleted without taking the ' +
     'campaign with it — losing a campaign because somebody tidied an avatar ' +
     'would be a nasty surprise', (() => {
      query(`insert into public.studio_campaigns (id,name,template_id,avatar_id) values ('c2','x','t','av1')`)
      query(`delete from public.studio_avatars where id='av1'`)
      return (query(`select count(*) from public.studio_campaigns where id='c2'`).stdout || '').trim() === '1'
    })())

  ok('the campaign job primary key stops the same row being queued twice', (() => {
    query(`insert into public.studio_campaign_jobs (campaign_id,row_index,state) values ('c2',0,'pending')`)
    const r = query(`insert into public.studio_campaign_jobs (campaign_id,row_index,state) values ('c2',0,'pending')`)
    return r.status !== 0
  })())

  ok('every new table carries a comment explaining why it exists', (() => {
    // ONE LINE, DELIBERATELY. This query is passed through `su -c`, so a
    // newline inside it is mangled by the shell before psql ever sees it and
    // the assertion fails for a reason that has nothing to do with the schema.
    const commented = list(
      `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and obj_description(c.oid,'pg_class') is not null and c.relname in (${NEW.map(t => `'${t}'`).join(',')})`)
    return commented.length === NEW.length
  })())
} finally {
  stop()
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)

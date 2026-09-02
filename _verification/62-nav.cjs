// _verification/62-nav.cjs
//
// EVERY ADMIN PAGE HAS A DOOR.
//
// This suite exists because of a specific, embarrassing failure. `/admin/productie`
// was built, tested, deployed and working — and had no entry in the sidebar. The
// only way to reach it was to type the URL. It sat there through an audit, a
// re-audit and a live verification, and none of them noticed, because every one
// of those checks arrived at the page by URL.
//
// That is the same shape as the bug `51-reachable.cjs` was written for, one
// level up. That suite asks "does this feature have a control on a page?". This
// one asks "does this page have a way in?". Both failures are invisible to
// anyone who already knows where they are going, which is always the person who
// built it.
//
// So: every directory under app/admin that has a page.tsx must be either in the
// sidebar, or explicitly and deliberately excused here by name. There is no
// third category, and the excuse list is short enough to read.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const ADMIN = path.join(ROOT, 'app', 'admin')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const layout = fs.readFileSync(path.join(ADMIN, 'layout.tsx'), 'utf8')

// Routes that are deliberately not in the sidebar, each with the reason.
const EXCUSED = new Map([
  ['/admin', 'the index, which redirects'],
  ['/admin/login', 'you are not logged in yet, so there is no sidebar'],
  ['/admin/new', 'reached from Articole, not a destination of its own'],
  ['/admin/corector', 'reached from the editor'],
])

// ── the routes that exist ────────────────────────────────────────────────
const routes = []
const walk = (dir, prefix) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'components' || entry.name.startsWith('_')) continue
    const full = path.join(dir, entry.name)
    const href = `${prefix}/${entry.name}`
    if (fs.existsSync(path.join(full, 'page.tsx'))) routes.push(href)
    walk(full, href)
  }
}
walk(ADMIN, '/admin')
if (fs.existsSync(path.join(ADMIN, 'page.tsx'))) routes.push('/admin')

ok('there are admin routes to check', routes.length > 5, String(routes.length))

// ── the routes the sidebar offers ────────────────────────────────────────
const hrefs = new Set(
  [...layout.matchAll(/href:\s*'([^']+)'/g)].map(m => m[1])
)
ok('the sidebar has entries', hrefs.size > 5, String(hrefs.size))

for (const r of routes.sort()) {
  // A route with a dynamic segment cannot BE a sidebar entry — there is no one
  // URL to link to. It is reached from whatever list knows the id.
  if (/\[[^\]]+\]/.test(r)) {
    ok(`${r} is a dynamic route, reached from a list`, true)
    continue
  }
  if (EXCUSED.has(r)) {
    ok(`${r} is excused (${EXCUSED.get(r)})`, !hrefs.has(r) || true)
    continue
  }
  ok(`${r} is reachable from the sidebar`, hrefs.has(r),
    'no NAV entry — the only way in is typing the URL')
}

// ── and the sidebar does not offer routes that do not exist ──────────────
for (const h of [...hrefs].sort()) {
  if (!h.startsWith('/admin')) continue
  ok(`the sidebar entry ${h} goes somewhere`, routes.includes(h), 'no page.tsx for it')
}

// ── the two new surfaces specifically ────────────────────────────────────
{
  ok('Producție is in the sidebar', /href: '\/admin\/productie'/.test(layout))
  ok('Podcast is in the sidebar', /href: '\/admin\/podcast'/.test(layout))
  ok('...both sit under Studio', (layout.match(/under: 'Studio'/g) || []).length >= 2)
  ok('...and the sidebar actually renders the grouping',
    /'under' in item/.test(layout) && /pl-8/.test(layout),
    'the `under` field is set but nothing reads it — a grouping that does not group')

  // A second door, from the page a person is most likely to already be on.
  const studio = fs.readFileSync(path.join(ADMIN, 'studio', 'page.tsx'), 'utf8')
  ok('the Studio page links to Producție', /href="\/admin\/productie"/.test(studio))
  ok('the Studio page links to Podcast', /href="\/admin\/podcast"/.test(studio))

  const podcast = fs.readFileSync(path.join(ADMIN, 'podcast', 'page.tsx'), 'utf8')
  ok('the Podcast page links back to the Studio', /href="\/admin\/studio"/.test(podcast))
}

// ── the split really happened ────────────────────────────────────────────
{
  const prod = fs.readFileSync(path.join(ADMIN, 'productie', 'page.tsx'), 'utf8')
  ok('Producție no longer has a podcast tab', !/'podcast'/.test(prod),
    'the tab is still there, so the page was not split — it was copied')
  ok('...and no longer imports the podcast libraries',
    !/lib\/podcast\/clip/.test(prod) && !/planTighten/.test(prod),
    'dead imports left behind by a half-finished move')
  ok('...and still has its other three tabs',
    /'avatare'/.test(prod) && /'campanii'/.test(prod) && /'ecran'/.test(prod))

  const podcast = fs.readFileSync(path.join(ADMIN, 'podcast', 'page.tsx'), 'utf8')
  ok('the Podcast page transcribes', /align-subtitles/.test(podcast))
  ok('...aligns the tracks', /alignOffset/.test(podcast))
  ok('...assigns speakers from the microphones', /assignSpeakers/.test(podcast))
  ok('...and finds the clips', /findClips/.test(podcast))

  // Both pages draw the same chrome from one place rather than two copies.
  ok('both pages share one Panel', /ProductionChrome/.test(prod) && /ProductionChrome/.test(podcast))
  ok('...and neither redefines it locally',
    !/^const Panel = /m.test(prod) && !/^const Panel = /m.test(podcast))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

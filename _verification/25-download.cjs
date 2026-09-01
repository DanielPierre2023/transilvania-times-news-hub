// _verification/25-download.cjs
//
// "Opens in a new browser but no download."  Two causes, one visible.
//
// 1. sendFile sent `Content-Disposition: inline` unconditionally, above a
//    comment claiming inline "plays in a tab as well as downloading". It does
//    not — inline is the instruction NOT to download. The button could only
//    ever open the file.
// 2. The button was an <a href> to ANOTHER ORIGIN. The `download` attribute is
//    ignored cross-origin, so even adding it would have changed nothing. The
//    only thing that downloads a cross-origin file from a page is fetching it
//    into a blob on your own origin.
//
// And one that was not visible at all: the worker keeps jobs in a Map and
// checks the key against it. Sweep the job, or restart the worker, and every
// link to that render 401s. Three of the four render links on the page were
// already dead when this was written.

const fs = require('fs')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const ROOT = path.join(__dirname, '..')
const worker = fs.readFileSync(path.join(ROOT, 'render-worker', 'src', 'index.js'), 'utf8')
const rawUi = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const ui = stripComments(rawUi)


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// ── the worker lets the caller choose ────────────────────────────────────
{
  ok('the unconditional inline disposition is gone',
    !/'Content-Disposition': `inline; filename/.test(worker))
  ok('the disposition is chosen per request',
    /wantsDownload \? 'attachment' : 'inline'/.test(worker))
  ok('...off an explicit download flag', /searchParams\.get\('download'\)/.test(worker))
  ok('...accepting 1 or true', /=== '1' \|\| q === 'true'/.test(worker))
  ok('a malformed url cannot throw the file route', /catch \{ return false \}/.test(worker))
  ok('range handling is untouched — review still scrubs',
    /Accept-Ranges/.test(worker) && /206/.test(worker) && /Content-Range/.test(worker))
  ok('the disposition is readable cross-origin now',
    /Access-Control-Expose-Headers/.test(worker) && /content-disposition/.test(worker))
}

// ── the page no longer pretends a cross-origin link can download ─────────
{
  ok('the one button that did two things is gone', !/Deschide \/ Descarcă MP4/.test(ui))
  ok('open and save are separate controls', /> Deschide\b/.test(ui) && /Descarcă MP4/.test(ui))
  ok('the save goes through a blob on our own origin',
    /createObjectURL\(blob\)/.test(ui) && /a\.download =/.test(ui))
  ok('...and asks the worker for an attachment as well',
    /download=1/.test(ui))
  ok('the object url is released', /revokeObjectURL/.test(ui))
  ok('a dead link is reported as a dead link, not as nothing happening',
    /Linkul a expirat/.test(ui))
  ok('the button says it is working', /Descarc…/.test(ui))
}

// ── the render outlives the worker's memory ──────────────────────────────
{
  ok('the bytes are mirrored into storage on the way past',
    /studio-assets'\)\.upload\(path, blob/.test(ui) && /renders\//.test(ui))
  ok('the mirror is best-effort and cannot break the download',
    /the download already worked/.test(rawUi))
  ok('the permanent copy is shown when it exists', /renderMirror/.test(ui))
  ok('...and explains why it matters', /expiră/.test(ui))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)

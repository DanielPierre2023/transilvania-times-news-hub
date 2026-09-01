// _verification/51-reachable.cjs
//
// EVERY FEATURE IN THIS ROUND HAS A CONTROL.
//
// This project has now shipped the same bug three times: a capability built,
// compiled, wired into the worker, covered by tests — and with no way for
// anyone using the Studio to switch it on. The audio chain. Then the per-shot
// temperature and tint. Both times everything passed and the feature did not
// exist for the person using the tool.
//
// So this suite asserts REACHABILITY, and it is deliberately the dumbest suite
// in the set: for each thing built this round, is there a control in a page
// that writes to the state the engine reads? It cannot prove the control is
// good. It can prove the control is there, which is the failure that keeps
// happening.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')

const studioRaw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const prodRaw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'productie', 'page.tsx'), 'utf8')
// Comments are stripped so a commented-out line cannot satisfy an assertion.
//
// A REGEX CANNOT DO THIS, AND THE PROOF IS IN THIS FILE'S HISTORY.
//
// The obvious `/\/\*[\s\S]*?\*\//g` deleted ten thousand characters of this
// page and made twelve assertions fail against code that was plainly there.
// The cause is `accept="image/*"`: a file input's MIME filter contains the two
// characters that open a block comment, so the strip ran from an attribute in
// the markup to the next `*/` hundreds of lines later. Every earlier suite in
// this repository that strips comments with a regex has the same latent bug;
// it simply has not met an `image/*` yet.
//
// So this is a scanner that knows what a string is.
function strip(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += c; i++
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        out += src[i]
        if (src[i] === quote) { i++; break }
        i++
      }
      continue
    }
    if (c === '/' && d === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    out += c
    i++
  }
  return out
}
const studio = strip(studioRaw)
const prod = strip(prodRaw)

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// ── speed ramps ──────────────────────────────────────────────────────────
{
  ok('SPEED RAMPS have a control in the Studio', /SPEED_PRESETS\)\.map/.test(studio))
  ok('...that writes to the scene', /speed: v \? v as keyof typeof SPEED_PRESETS/.test(studio))
  ok('...and the build reads it back', /SPEED_PRESETS\[sc\.speed\]/.test(studio))
  ok('...and it is offered only on clips, where it can do anything',
    /sc\.kind === 'video' && \(\s*<select value=\{sc\.speed/.test(studio.replace(/\s+/g, ' ').replace(/ \(/g, ' (')) ||
    /sc\.kind === 'video'[\s\S]{0,80}sc\.speed/.test(studio))
  ok('...and the preset note is shown, not just the name', /SPEED_PRESETS\[sc\.speed\]\.note/.test(studio))
}

// ── wipes ────────────────────────────────────────────────────────────────
{
  ok('WIPES reach the transition selector', /Object\.entries\(TRANSITIONS\)\.map/.test(studio))
  const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
  ok('...and every wipe kind is in TRANSITIONS, so the selector really offers them',
    T.WIPE_KINDS.every(k => T.TRANSITIONS[k]))
  ok('...and the build passes the chosen kind straight through',
    /kind: sc\.trans/.test(studio))
}

// ── 4K and the ladder ────────────────────────────────────────────────────
{
  ok('THE MASTER LADDER is driven by the shared table', /TIER_ORDER\.map/.test(studio))
  ok('...so adding a tier adds a button with no further work',
    !/\['1080', '720'\]/.test(studio))
  ok('THE 4K HONESTY LINE IS RENDERED, not merely computed',
    /describeDelivery\(\{ tier: master \}/.test(studio))
  ok('...and it shows the warning when there is one', /d\.warning &&/.test(studio))
  ok('...and it reports the render time, which is what 4K really costs',
    /d\.renderSeconds/.test(studio))
  ok('...and it measures the WEAKEST shot, not the average — one 4K hero among ' +
     'nine 1080 shots still looks like 1080', /Math\.min\(acc, w\)/.test(studio))
}

// ── avatars ──────────────────────────────────────────────────────────────
{
  ok('AVATARS have a page', prod.length > 2000)
  ok('...with a hero still that can be uploaded', /hero_url|heroUrl: url/.test(prod))
  ok('...and references', /referenceUrls: \[\.\.\.x\.referenceUrls/.test(prod))
  ok('...capped at what the model reads', /slice\(0, MAX_REFERENCES\)/.test(prod))
  ok('THE IDENTITY DIFFERENCE IS SHOWN TO THE USER — the whole point is that ' +
     'one mode is exact and the other is close', /spec\.identityNote/.test(prod))
  ok('...and both modes are displayed side by side',
    /\['hero', 'reference'\] as AvatarMode\[\]/.test(prod))
  ok('...and the warnings are rendered', /checkAvatar\(avatar\)\.map/.test(prod))
  ok('...and it saves to the table the migration creates', /from\('studio_avatars'\)/.test(prod))
  ok('A NEW SHOT OF THE SAME PERSON CAN ACTUALLY BE GENERATED — the reference ' +
     'mode was described in the interface with no way to reach it, which is a ' +
     'note explaining a capability nobody has',
    /generate-image-edit/.test(prod))
  ok('...conditioned on the saved references, not on the prompt alone',
    /image_urls: spec\.referenceUrls/.test(prod))
  ok('...and the generated shot can be kept', /Adaugă la referințe/.test(prod))
  ok('...or promoted to the fixed frame', /Fă-l cadrul fix/.test(prod))
  ok('AN AVATAR CAN BE DELETED — found by testing the live environment, where a ' +
     'test avatar could be created and never removed',
    /from\('studio_avatars'\)\.delete\(\)/.test(prod))
  ok('...and it asks first', /confirm\(/.test(prod))
}

// ── the grade style, and the divergence it closes ────────────────────────
{
  ok('THE PREVIEW PASSES CONTRAST AND SATURATION — it ignored both while the ' +
     'worker applied them at a hard-coded 1.04/1.06, so every film rendered ' +
     'punchier than the one that was approved',
    /gradeFilterUrl\(gains, kit\.grade\.contrast/.test(studio))
  ok('...and the filter is rebuilt when they change, not reused under the old id',
    /\$\{ID\}-\$\{contrast\.toFixed/.test(studio))
  ok('THERE IS A STYLE SELECTOR, so those are decisions rather than constants',
    /GRADE_STYLES\[e\.target\.value as GradeStyleName\]/.test(studio))
  ok('...showing which style is currently in force', /styleOf\(kit\.grade\.contrast/.test(studio))
  ok('...and the actual numbers beside it', /kit\.grade\.saturation \?\? 1\.06/.test(studio))
}

// ── cutting to speech ────────────────────────────────────────────────────
{
  ok('THE CUTS CAN BE CHECKED AGAINST THE SPEECH', /syncToSpeech\(false\)/.test(studio))
  ok('...and moved onto phrase boundaries', /syncToSpeech\(true\)/.test(studio))
  ok('...using the shared aligner, not a second implementation',
    /alignCutsToSpeech\(durations, words/.test(studio))
  ok('THE PROBLEMS ARE SHOWN, not just fixed silently', /syncIssues\.slice\(0, 6\)/.test(studio))
  ok('...and a clean film says so', /cade pe o margine de frază/.test(studio))
  ok('THE SCRIPT CAN BE SHAPED SO THE VOICE BREATHES AT THE CUTS — pauses land ' +
     'only between paragraphs, so a one-block script reads through every cut',
    /shapeScriptForShots/.test(studio) && /splitScriptForShots\(script/.test(studio))
  ok('...and it tells you to regenerate the voice, which is what actually ' +
     'applies the pauses', /Regenerează vocea/.test(studio))
  ok('sync is refused without word timings rather than guessing',
    /Aliniază întâi subtitrările/.test(studio))
}

// ── templates and campaigns ──────────────────────────────────────────────
{
  ok('TEMPLATES are listed', /byCategory\(cat\)\.map/.test(prod))
  ok('...by category', /Object\.keys\(CATEGORY_LABEL\)/.test(prod))
  ok('...and every slot gets an input', /template\.slots\.map/.test(prod))
  ok('...showing the hint, which is the part nobody has', /\{s\.hint\}/.test(prod))
  ok('...and the length budget is visible as it is typed', /\{s\.maxChars &&/.test(prod))
  ok('THE PER-BEAT JOB IS SHOWN — it is the most useful line in a template',
    /template\.beats\.map/.test(prod) && /\{b\.job\}/.test(prod))

  ok('A SPREADSHEET CAN BE PASTED', /parseRows/.test(prod) && /setPasted/.test(prod))
  ok('...and its problems are shown before anything is spent', /validateRows/.test(prod))
  ok('ALL THREE PERSONALISATION MODES are offered', /Object\.keys\(MODES\)/.test(prod))
  ok('...with the note explaining the cost difference', /MODES\[m\]\.note/.test(prod))
  ok('THE ESTIMATE IS SHOWN BEFORE THE RUN', /estimate\.usd\.toFixed/.test(prod))
  ok('...broken down', /estimate\.breakdown\.map/.test(prod))
  ok('...with render time separate from money', /estimate\.renderMinutes/.test(prod))
  ok('...and the warnings rendered', /estimate\.warnings\.map/.test(prod))
  ok('THE SPEND CEILING IS EDITABLE and blocks the run', /setCeiling/.test(prod) && /!g\.allowed/.test(prod))
  ok('...and a big campaign needs an explicit confirmation',
    /g\.needsConfirmation && !confirmed/.test(prod))
  ok('...and the button is disabled until all of that passes',
    /disabled=\{running \|\| !g\.allowed \|\| \(g\.needsConfirmation && !confirmed\)/.test(prod))
  ok('...including while a run is already going, so one campaign cannot be ' +
     'started twice from the same tab', /disabled=\{running \|\|/.test(prod))
}

// ── the campaign queue ───────────────────────────────────────────────────
{
  ok('THE CAMPAIGN CAN ACTUALLY BE RUN, not merely prepared', /onClick=\{startRun\}/.test(prod))
  ok('...through the shared runner rather than a second loop', /runCampaign\(/.test(prod))
  ok('THE CLAIM GOES THROUGH THE ATOMIC DATABASE FUNCTION — a select followed ' +
     'by an update lets two drivers take the same row, render it twice and pay ' +
     'twice, with nothing looking wrong afterwards',
    /rpc\('claim_campaign_job'/.test(prod))
  ok('...and finishing a row goes through the function that also moves the ' +
     'campaign total, so the two cannot disagree', /rpc\('finish_campaign_job'/.test(prod))
  ok('...and a failure records its backoff', /rpc\('fail_campaign_job'/.test(prod))
  ok('...and a released row is handed back', /rpc\('release_campaign_job'/.test(prod))

  ok('THE RUN CAN BE STOPPED CLEANLY', /runRef\.current\?\.stop\(\)/.test(prod))
  ok('...and abandoned outright', /runRef\.current\?\.abort\(\)/.test(prod))
  ok('A CLOSED TAB RELEASES ITS ROWS rather than stranding them behind a ' +
     'ten-minute lease', /beforeunload/.test(prod))

  ok('progress is rendered', /runProgress\.percent/.test(prod))
  ok('...with what has ACTUALLY been spent against the ceiling',
    /runProgress\.spend\.spentUsd/.test(prod))
  ok('...and the measured per-row rate, which is the honest number',
    /runProgress\.spend\.perRowUsd/.test(prod))
  ok('...and a projection of where it is heading', /projectedUsd/.test(prod))
  ok('...and an eta', /runProgress\.etaMs/.test(prod))
  ok('the halt reason is shown, not swallowed', /\{runHalt\}/.test(prod))
  ok('per-row events are logged so a long run can be watched', /onRowFail:/.test(prod))
  ok('RESUMING DOES NOT RE-QUEUE FINISHED ROWS — ignoreDuplicates keeps their ' +
     'attempts and their spend', /ignoreDuplicates: true/.test(prod))
  ok('...and the button says so when a campaign already exists',
    /Reia campania/.test(prod))
}

// ── the last four capabilities ───────────────────────────────────────────
{
  ok('EACH ROW GETS ITS TIMELINE STORED — the poller renders a document that ' +
     'already exists rather than building one, so its films are identical to ' +
     'the tab\'s by construction', /base\.timeline = rowTimeline\(project/.test(prod))
  ok('...and it is written back after a per-row generation too',
    /\.update\(\{ timeline \}\)/.test(prod))

  ok('FULLY GENERATED CAMPAIGNS ACTUALLY GENERATE', /generateRow\(draft, sheet\.rows/.test(prod))
  ok('...through the real image function', /generate-cover-image/.test(prod))
  ok('...metering every unit into the ledger', /from\('studio_usage'\)\.insert/.test(prod))
  ok('...and checking the budget against what has really been spent',
    /select\('spent_usd, ceiling_usd'\)/.test(prod))
  ok('THE ESTIMATE COUNTS WHAT THE LOOP WILL GENERATE, not the template\'s beats',
    /costPerRow\(one\)/.test(prod))

  ok('SPEAKERS ARE ATTRIBUTED FROM THE MICROPHONES — Whisper does not diarise, ' +
     'and with a lapel each the recording already contains the answer',
    /assignSpeakers\(all, envelopes/.test(prod))
  ok('...with the measured alignment applied to the envelopes first, or words go ' +
     'to whoever was loud half a second later', /m\.offset \?\? 0\) \* HZ/.test(prod))
  ok('...and the separation is reported rather than assumed',
    /separationOf\(all, envelopes/.test(prod) && /SEPARATION_MIN/.test(prod))
  ok('...saying plainly when two mics cannot tell the speakers apart',
    /nu separă vorbitorii/.test(prod))

  ok('A RANKED CLIP CAN BE TURNED INTO A FINISHED VERTICAL — a list of timecodes ' +
     'is not a deliverable', /buildClipProject\(\{/.test(prod))
  ok('...using the cameras, with their offsets', /offsetSeconds: t\.offset/.test(prod))
  ok('...and it reports what could not be done', /project\.warnings\.length/.test(prod))
}

// ── podcast ──────────────────────────────────────────────────────────────
{
  ok('PODCAST tracks can be uploaded', /setTracks\(l => \[\.\.\.l/.test(prod))
  ok('...and labelled by speaker, which is what two-camera cutting needs',
    /speaker: e\.target\.value/.test(prod))
  ok('ALIGNMENT IS OFFERED', /onClick=\{align\}/.test(prod))
  ok('...and uses the measured shift, not a guess', /r\.shiftBBySeconds/.test(prod))
  ok('LOW CONFIDENCE IS SHOWN RATHER THAN SILENTLY TRUSTED — an automatic sync ' +
     'that is wrong is worse than none, because nobody re-checks it',
    /SYNC_CONFIDENCE_MIN/.test(prod))
  ok('TRANSCRIPTION IS CHUNKED', /planChunks/.test(prod))
  ok('...and stitched back into one timeline', /stitch\(parts\)/.test(prod))
  ok('TIGHTENING is shown with what it removes', /secondsRemoved\(cuts\)/.test(prod))
  ok('...and the retimed transcript is what everything downstream uses',
    /retime\(words, cuts\)/.test(prod))
  ok('CLIPS are listed', /clips\.map/.test(prod))
  ok('...with the reason each was chosen', /\{c\.why\}/.test(prod))
  ok('CHAPTERS are listed', /chapterList\.map/.test(prod))
  ok('SPEAKER SWITCHES are reported', /switches\.length/.test(prod))
}

// ── screen ───────────────────────────────────────────────────────────────
{
  ok('SCREEN CAPTURE can be started', /getDisplayMedia/.test(prod))
  ok('...and stopped', /recRef\.current\?\.stop\(\)/.test(prod))
  ok('STOPPING THE SHARE FROM CHROME\'S OWN BAR ALSO STOPS THE RECORDER — ' +
     'otherwise it records a dead track and the file ends with no explanation',
    /addEventListener\('ended'/.test(prod))
  ok('a file can be uploaded instead', /accept="video\/\*"/.test(prod))
  ok('READABILITY IS REPORTED before the film is built', /readability\(screenSize/.test(prod))
  ok('DEAD AIR IS ACTUALLY DETECTED, not just importable',
    /deadAir\(changes, HZ\)/.test(prod))
  ok('...from real frames sampled out of the video', /drawImage\(v, 0, 0, W, H\)/.test(prod))
  ok('...and turned into speed points rather than cuts', /skipPoints\(dead, 25\)/.test(prod))
  ok('FOCUS POINTS can be added and adjusted', /setFocuses/.test(prod))
  ok('...and become crop keyframes', /cropKeys\(focuses/.test(prod))
  ok('DEVICE FRAMES are offered with their honest notes',
    /Object\.entries\(DEVICE_FRAMES\)/.test(prod) && /\{v\.note\}/.test(prod))
}

// ── nothing is imported and left unused ──────────────────────────────────
{
  // The direct check for the bug this suite exists to catch.
  const imported = [...prodRaw.matchAll(/import \{([^}]+)\} from/g)]
    .flatMap(m => m[1].split(',').map(s => s.trim().split(' as ').pop().trim()))
    .filter(n => n && !n.startsWith('type '))
  const unused = imported.filter(n => {
    const uses = prodRaw.split(new RegExp(`\\b${n.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&')}\\b`)).length - 1
    return uses <= 1
  })
  ok('NOTHING IS IMPORTED INTO THE PRODUCTION PAGE AND LEFT UNUSED — an unused ' +
     'import is the signature of a feature that was built and never wired up',
    unused.length === 0, unused.join(', '))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)

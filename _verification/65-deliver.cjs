// _verification/65-deliver.cjs
//
// THE EIGHT FILES A PUBLISHED EPISODE ACTUALLY IS.
//
// Two of these have a specific, silent failure that is worth the whole suite:
//
//   YOUTUBE DISCARDS AN ENTIRE CHAPTER LIST whose first entry is not at 00:00.
//   Not the first chapter — the whole list. So an episode whose chapters begin
//   after a forty-second intro publishes with no chapters at all, and nothing
//   anywhere says why. Everyone hits this once.
//
//   THE TEXT ENDPOINT RUNS ITS ANSWER THROUGH A NEWS-ARTICLE SANITISER on the
//   way back. Read `supabase/functions/_shared/sanitize.ts`: it strips `#`
//   headings, unwraps lines that are only **bold**, deletes a line that is
//   exactly a conclusion heading, and DELETES THE WHOLE LAST PARAGRAPH if it
//   opens with "În concluzie", "Pe scurt", "Astfel," and about fifteen others.
//   A prompt asking for JSON or markdown headings comes back mangled, so the
//   prompt is shaped around the sanitiser and the parser is tested against
//   what the sanitiser leaves behind.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const D = require(path.join(ROOT, 'render-worker', 'dist', 'podcast', 'deliver.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// ── timecodes ────────────────────────────────────────────────────────────
{
  ok('under a minute', D.timecode(9) === '0:09', D.timecode(9))
  ok('minutes and seconds', D.timecode(125) === '2:05', D.timecode(125))
  ok('an hour brings the hours in', D.timecode(3725) === '1:02:05', D.timecode(3725))
  ok('...and pads the minutes when it does', D.timecode(3605) === '1:00:05', D.timecode(3605))
  ok('a fraction floors rather than rounds up past the frame',
    D.timecode(9.99) === '0:09', D.timecode(9.99))
  ok('zero is zero', D.timecode(0) === '0:00')
  ok('a negative is clamped', D.timecode(-5) === '0:00', D.timecode(-5))
}

// ── chapters: the 00:00 rule ─────────────────────────────────────────────
{
  const late = [{ start: 42, title: 'Primul subiect' }, { start: 300, title: 'Al doilea' }]
  const lines = D.chapterLines(late).split('\n')
  ok('A LIST THAT STARTS LATE GETS A 00:00 ENTRY — without it YouTube throws ' +
     'away every chapter, not just the first', lines[0].startsWith('0:00'), lines[0])
  ok('...and the original entries survive', lines.length === 3, JSON.stringify(lines))
  ok('...in order', lines[1].startsWith('0:42') && lines[2].startsWith('5:00'),
    JSON.stringify(lines))
  ok('...with a name for the added one', /0:00 \S/.test(lines[0]), lines[0])

  const onTime = [{ start: 0, title: 'Intro' }, { start: 90, title: 'Subiect' }]
  ok('a list that already starts at zero is not given a duplicate',
    D.chapterLines(onTime).split('\n').length === 2)

  const nearZero = [{ start: 0.2, title: 'Intro' }]
  ok('a chapter a fraction after zero is snapped, not duplicated',
    D.chapterLines(nearZero) === '0:00 Intro', D.chapterLines(nearZero))

  ok('no chapters is an empty string, not a stray heading', D.chapterLines([]) === '')

  const j = D.chaptersJson(late, { title: 'Podcastul' })
  ok('the Podcasting 2.0 document declares its version', j.version === '1.2.0')
  ok('...carries the chapters', j.chapters.length === 2)
  ok('...with startTime, which is the field name the spec uses',
    j.chapters[0].startTime === 42, JSON.stringify(j.chapters[0]))
  ok('...and the podcast name when given', j.podcastName === 'Podcastul')
  ok('...and omits it when not', D.chaptersJson(late).podcastName === undefined)
}

// ── the transcript, for the archive and for the prompt ───────────────────
{
  const words = [
    { word: 'Bună', start: 0, end: 0.4, speaker: 'Ana' },
    { word: 'ziua', start: 0.4, end: 0.8, speaker: 'Ana' },
    { word: '.', start: 0.8, end: 0.85, speaker: 'Ana' },
    { word: 'Salut', start: 1.5, end: 2.0, speaker: 'Bogdan' },
  ]
  const t = D.transcriptText(words)
  ok('the transcript names the speakers', /Ana:/.test(t) && /Bogdan:/.test(t), t)
  ok('a change of speaker starts a new block', t.split('\n\n').length === 2, JSON.stringify(t))
  ok('punctuation is not left floating after a space', !/ \./.test(t), JSON.stringify(t))
  ok('...and it can be asked for without the names',
    !/Ana:/.test(D.transcriptText(words, { withSpeakers: false })))

  const many = []
  for (let i = 0; i < 200; i++) many.push({ word: 'w' + i, start: i, end: i + 0.5 })
  const stamped = D.transcriptWithTimecodes(many, 30)
  ok('the timecoded transcript marks every 30 seconds',
    stamped.split('\n\n').length >= 6, String(stamped.split('\n\n').length))
  ok('...starting at zero', stamped.startsWith('[0:00]'), stamped.slice(0, 12))
  ok('...and the marks go up', (() => {
    const secs = [...stamped.matchAll(/\[(\d+):(\d\d)\]/g)].map(m => +m[1] * 60 + +m[2])
    return secs.every((v, i) => i === 0 || v > secs[i - 1])
  })())
}

// ── the prompt is shaped around the sanitiser ────────────────────────────
{
  const prompt = D.showNotesPrompt({ minutes: 47, speakers: ['Ana', 'Bogdan'] })
  ok('the prompt says how long the episode is', /47/.test(prompt))
  ok('...and who is in it', /Ana/.test(prompt) && /Bogdan/.test(prompt))
  ok('...and asks for Romanian', /ROMÂN/i.test(prompt))
  ok('IT FORBIDS MARKDOWN HEADINGS, which the sanitiser strips',
    /fără titluri cu diez/i.test(prompt))
  ok('...and bold-only lines, which it unwraps', /doar cu bold/i.test(prompt))
  ok('IT ENDS WITH A SENTINEL, so anything eaten for looking like a conclusion ' +
     'is the sentinel and not the notes',
    prompt.trim().endsWith(D.NOTES_SENTINEL), prompt.slice(-40))

  // The sanitiser's real rules, restated here so this suite fails if the
  // prompt ever starts asking for something they would destroy.
  const sanitizer = fs.readFileSync(
    path.join(ROOT, 'supabase', 'functions', '_shared', 'sanitize.ts'), 'utf8')
  ok('the sanitiser really does strip headings (it has not changed under us)',
    /\^#\{1,6\}\\s\+/.test(sanitizer))
  ok('...and really does delete a trailing conclusion paragraph',
    /removeLastConclusionParagraph/.test(sanitizer))
  ok('the endpoint really does run it on the way back',
    /sanitizeContent/.test(fs.readFileSync(
      path.join(ROOT, 'supabase', 'functions', 'ai-blog-assistant', 'index.ts'), 'utf8')))
}

// ── the parser is tolerant ───────────────────────────────────────────────
{
  const good = [
    'TITLU: Cum se face un podcast',
    'SUBTITLU: O conversație despre montaj.',
    'DESCRIERE: Primul paragraf.',
    '',
    'Al doilea paragraf.',
    'CUVINTE: podcast, montaj, radio',
    'CITATE:',
    '- Prima replică',
    '- A doua replică',
    'GATA',
  ].join('\n')
  const p = D.parseShowNotes(good)
  ok('the title is read', p.title === 'Cum se face un podcast', p.title)
  ok('the subtitle is read', /conversație/.test(p.subtitle), p.subtitle)
  ok('the description keeps both paragraphs',
    /Primul/.test(p.description) && /Al doilea/.test(p.description), p.description)
  ok('...without the sentinel trailing on it', !/GATA/.test(p.description), p.description)
  ok('the keywords are split', p.keywords.length === 3, JSON.stringify(p.keywords))
  ok('the quotes lose their bullets',
    p.quotes.length === 2 && p.quotes[0] === 'Prima replică', JSON.stringify(p.quotes))
  ok('the raw answer is kept whatever the parser did', p.raw.includes('GATA'))

  // MISSING FIELDS ARE THE NORMAL CASE, not the exception.
  const partial = D.parseShowNotes('TITLU: Doar titlul\nCUVINTE: a, b')
  ok('a missing subtitle is empty, not undefined', partial.subtitle === '')
  ok('a missing description is empty', partial.description === '')
  ok('a missing quote list is an empty array', Array.isArray(partial.quotes) && partial.quotes.length === 0)
  ok('...and what IS there is still read', partial.title === 'Doar titlul')

  ok('an empty answer does not throw', (() => {
    try { const e = D.parseShowNotes(''); return e.title === '' && e.raw === '' } catch { return false }
  })())
  ok('a null answer does not throw', (() => {
    try { return D.parseShowNotes(null).title === '' } catch { return false }
  })())

  // The sanitiser strips a leading `#`. The parser must still find the label.
  ok('a heading marker the sanitiser missed does not break the label',
    D.parseShowNotes('TITLU: Titlu\nDESCRIERE: Text').description === 'Text')
  ok('lower-case labels are accepted too',
    D.parseShowNotes('titlu: Merge\n').title === 'Merge')
}

// ── the description a person pastes ──────────────────────────────────────
{
  const notes = { description: 'Despre montajul unui podcast.' }
  const chapters = [{ start: 0, title: 'Intro' }, { start: 120, title: 'Montajul' }]
  const full = D.fullDescription(notes, chapters, 'Abonează-te.')
  ok('the description comes first', full.startsWith('Despre montajul'), full.slice(0, 30))
  ok('the chapters are in it', /Capitole:/.test(full) && /2:00 Montajul/.test(full), full)
  ok('...and the extra line at the end', full.trim().endsWith('Abonează-te.'))
  ok('no chapters means no empty heading',
    !/Capitole:/.test(D.fullDescription(notes, [])))
  ok('no extra means no trailing blank', !/\n\n$/.test(D.fullDescription(notes, chapters)))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

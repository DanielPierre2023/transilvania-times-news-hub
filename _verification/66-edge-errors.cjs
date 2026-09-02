// _verification/66-edge-errors.cjs
//
// THE FUNCTION SAID WHY. THE SCREEN MUST SAY IT TOO.
//
// This suite exists because of one support message: "Voice cloning does not
// work. I have an error: Edge Function returned a non-2xx status code."
//
// That sentence is supabase-js's fixed string for EVERY failed edge call. The
// function had answered, precisely:
//
//   fal minimax voice-clone 422: Unsupported audio format.
//   Supported formats are .wav, .mp3.
//
// — and the client threw it away, because the real body lives in
// `error.context` and the page threw `error.message`. Two separate defects, and
// this suite covers both:
//
//   1. THE READER. `invokeEdge` must dig the body out, prefer it over the
//      generic message, survive a body that has already been read once, and
//      never crash on a shape it did not expect.
//
//   2. THE CALL SITES. No page may call `functions.invoke` and throw
//      `e.message`. Four pages had that two-line version and exactly one — the
//      Newsroom — had the correct one, which is what a fix living inside a page
//      looks like after a few months.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// The module is TypeScript; compile it the way the suites compile lib/timeline.
const E = require(path.join(ROOT, 'render-worker', 'dist', 'supabase', 'edgeError.js'))

/** A fake FunctionsHttpError: the generic message plus the real Response. */
const httpError = (status, body, type = 'application/json') => ({
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'Content-Type': type } }),
})

;(async () => {
  // ── the reader ─────────────────────────────────────────────────────────
  {
    const real = 'fal minimax voice-clone 422: Unsupported audio format. Supported formats are .wav, .mp3.'
    const e = httpError(502, { error: real })
    ok('THE REAL MESSAGE IS READ, not the generic one',
      (await E.readEdgeError(e)) === real, await E.readEdgeError(e))

    ok('the status is available', E.edgeStatus(e) === 502, String(E.edgeStatus(e)))

    // THE BODY CAN ONLY BE READ ONCE. Reading it without cloning leaves the
    // next reader an empty string, which reads as "the function said nothing" —
    // a false trail that looks like a crashed function.
    ok('reading twice still works, because the response is cloned',
      (await E.readEdgeError(e)) === real, 'the second read came back empty')

    ok('a `message` field is read when there is no `error` field',
      (await E.readEdgeError(httpError(400, { message: 'nope' }))) === 'nope')
    ok('a plain-text body is read', (await E.readEdgeError(
      httpError(500, 'boom', 'text/plain'))) === 'boom')
    ok('an unrecognised JSON shape is shown rather than dropped',
      /detail/.test(await E.readEdgeError(httpError(422, { detail: [{ msg: 'x' }] }))))
    ok('an empty body gives an empty string, not a crash',
      (await E.readEdgeError(httpError(500, ''))) === '')
    ok('an error with no context gives an empty string',
      (await E.readEdgeError({ message: 'x' })) === '')
    ok('null does not throw', (await E.readEdgeError(null)) === '')
    ok('a context that is not a Response does not throw',
      (await E.readEdgeError({ context: { nope: true } })) === '')
    ok('the status of a contextless error is null', E.edgeStatus({ message: 'x' }) === null)
  }

  // ── the translations, which are deliberately few ───────────────────────
  {
    ok('fal running out of credit says what to do, not "TOP_UP"',
      /credit/i.test(E.humaniseEdgeError('fal 403: {"detail":"TOP_UP required"}')))
    ok('...and the same for a locked account',
      /credit/i.test(E.humaniseEdgeError('User is locked')))
    ok('a missing fal key names the setting to add',
      /FAL_KEY/.test(E.humaniseEdgeError('FAL_KEY not set — add a fal.ai key')))
    ok('a consent refusal is explained in words',
      /consimțământ/i.test(E.humaniseEdgeError('CONSENT_REQUIRED: cloning needs consent')))

    // ANYTHING NOT ON THE LIST IS SHOWN VERBATIM. A wrong translation is worse
    // than none: it sends someone to fix a thing that is not broken.
    const untouched = 'fal minimax voice-clone 422: Unsupported audio format. Supported formats are .wav, .mp3.'
    ok('AN UNTRANSLATED MESSAGE IS PASSED THROUGH WORD FOR WORD',
      E.humaniseEdgeError(untouched) === untouched, E.humaniseEdgeError(untouched))
    ok('...including one nobody has seen before',
      E.humaniseEdgeError('something entirely new') === 'something entirely new')
  }

  // ── invokeEdge end to end ──────────────────────────────────────────────
  {
    const clientThatFails = (status, body) => ({
      functions: { invoke: async () => ({ data: null, error: httpError(status, body) }) },
    })

    let msg = ''
    try {
      await E.invokeEdge(clientThatFails(502, {
        error: 'fal minimax voice-clone 422: Unsupported audio format. Supported formats are .wav, .mp3.',
      }), 'voice-lab', { action: 'clone_fal' })
    } catch (err) { msg = err.message }

    ok('the thrown message names the function', /^voice-lab:/.test(msg), msg)
    ok('...and carries the provider\'s own words', /Unsupported audio format/.test(msg), msg)
    ok('...and does NOT say "non-2xx"', !/non-2xx/.test(msg), msg)

    // With no body at all there is nothing to say but the status — and the
    // status is the only thing separating "not deployed" from "crashed".
    let bare = ''
    try { await E.invokeEdge(clientThatFails(404, ''), 'missing-fn', {}) }
    catch (err) { bare = err.message }
    ok('a bodyless failure falls back to the status', /404/.test(bare), bare)

    // A 200 carrying { error } is a failure by default...
    let inBody = ''
    try {
      await E.invokeEdge({ functions: { invoke: async () => ({ data: { error: 'nu merge' }, error: null }) } },
        'fn', {})
    } catch (err) { inBody = err.message }
    ok('an error inside a 200 body is still a failure', /nu merge/.test(inBody), inBody)

    // ...unless the caller says otherwise, which the render-worker poll needs:
    // it answers 200 with { error } for a sleeping worker and the poll reads it.
    const passed = await E.invokeEdge(
      { functions: { invoke: async () => ({ data: { error: 'worker asleep' }, error: null }) } },
      'render-worker', {}, { errorInBodyIsFatal: false })
    ok('...and a caller can opt out and inspect the body itself',
      passed.error === 'worker asleep')

    const okData = await E.invokeEdge(
      { functions: { invoke: async () => ({ data: { voices: [1, 2] }, error: null }) } }, 'fn', {})
    ok('a success returns the data', Array.isArray(okData.voices) && okData.voices.length === 2)
    ok('a success with no data returns an object, not undefined',
      typeof (await E.invokeEdge(
        { functions: { invoke: async () => ({ data: null, error: null }) } }, 'fn', {})) === 'object')
  }

  // ── no page may go back to throwing e.message ──────────────────────────
  {
    const PAGES = ['studio', 'productie', 'podcast', 'newsroom']
    for (const name of PAGES) {
      const src = fs.readFileSync(path.join(ROOT, 'app', 'admin', name, 'page.tsx'), 'utf8')
      ok(`${name} uses the shared reader`, /invokeEdge/.test(src),
        'it calls functions.invoke directly, so every failure reads "non-2xx"')
      ok(`...and ${name} no longer throws the generic message for an edge call`,
        !/functions\.invoke\([\s\S]{0,200}?\n\s*if \((?:e|error)\) throw new Error\((?:e|error)\.message\)/.test(src),
        'a call site still discards the body')
    }
  }

  // ── the sample the provider will actually accept ───────────────────────
  {
    const studio = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
    ok('THE ACCEPTED FORMATS ARE NAMED IN THE CODE, not assumed',
      /CLONE_FORMATS = \['wav', 'mp3'\]/.test(studio))
    ok('...and anything else is converted rather than refused',
      /encodeWavFrom\(audio\)/.test(studio),
      'a file the browser can decode should not be handed back to the person')
    // WAS `encodeWav(samples, decoded.sampleRate)`, WHICH SHIPPED AND WAS WRONG.
    // `monoSlice` resamples to 16 kHz; the header then claimed 48 kHz and the
    // file played at 3x. `67-sample-rate.cjs` measures the pitch; this only
    // checks that the call site uses the pair that cannot be mismatched.
    ok('...at the SOURCE sample rate, because a clone reference is the one file ' +
       'that must not be downsampled', /monoAudio\(decoded\)/.test(studio))
    ok('...uploaded with the .wav extension, which is what fal reads',
      /uploadBlob\('voice-samples', prepared\.blob, prepared\.ext/.test(studio))
    ok('a format the browser cannot decode either is explained, not swallowed',
      /nu a putut să-l deschidă/.test(studio))
    ok('the conversion is reported as information, not as an error',
      /setNotice\(/.test(studio) && /const \[notice, setNotice\]/.test(studio))
    ok('the length is measured and shown',
      /CLONE_MIN_SECONDS/.test(studio) && /cloneSampleSeconds/.test(studio))
    ok('...with the actual number in the refusal, not just "too short"',
      /prepared\.seconds\.toFixed\(1\)/.test(studio))
    ok('the panel says which formats the service takes',
      /doar \.wav și \.mp3/.test(studio))
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()

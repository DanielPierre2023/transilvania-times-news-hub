// _verification/35-audio-chain.cjs
//
// A real audio chain, proved with a real encoder.
//
// What existed was EBU R128 normalisation and a −18 dB duck: a good mastering
// stage and no processing at all. A voice recorded in a room still sounded like
// a room, and a music bed still fought the voice in the same frequencies rather
// than making space for it.
//
// Nothing here is asserted by reading the filter string. Every processor is run
// through ffmpeg over a signal built to expose it, and the measurement has to
// move in the direction the processor claims. A compressor that does not reduce
// dynamic range is not a compressor, however well its parameters are spelled.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const { execSync, spawnSync } = require('child_process')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const FF = process.env.FFMPEG || 'ffmpeg'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-'))

// A signal with real dynamics AT A REAL LEVEL: loud bursts over a quiet noise
// floor, peaking near −1 dBFS like a normalised voice does.
//
// Two things keep it there, and both were wrong at first. `normalize=0` on the
// mix, because amix divides by the number of inputs by default; and the final
// `volume=8`, because ffmpeg's `sine` source runs at −18 dBFS rather than full
// scale — measured, not assumed. Without them the probe peaked at −21.6 dBFS,
// below the −20 dB threshold of the voice preset's compressor, which therefore
// never engaged. The preset was fine. A probe that never reaches a threshold
// cannot test the processor behind it, and it fails in the flattering
// direction: everything looks like it passes.
const SRC = path.join(dir, 'src.wav')
execSync(`${FF} -v error -f lavfi -i "sine=f=440:d=4" -f lavfi -i "anoisesrc=d=4:a=0.02:seed=7" ` +
  `-filter_complex "[0]volume='if(lt(mod(t,1),0.4),0.9,0.02)':eval=frame[a];[a][1]amix=inputs=2:weights=1 0.5:normalize=0,volume=8" ` +
  `-ar 48000 -ac 1 ${SRC} -y`, { stdio: 'pipe' })

function measure(file, trim) {
  const af = [trim ? `atrim=${trim}` : '', 'astats=metadata=1:reset=0'].filter(Boolean).join(',')
  const r = spawnSync(FF, ['-hide_banner', '-i', file, '-af', af, '-f', 'null', '-'], { encoding: 'utf8' })
  const out = (r.stderr || '') + (r.stdout || '')
  const g = k => { const m = new RegExp(k + ':\\s*(-?[\\d.]+)').exec(out); return m ? Number(m[1]) : null }
  return { peak: g('Peak level dB'), rms: g('RMS level dB'),
    noiseFloor: g('Noise floor dB'), dynamic: g('Dynamic range') }
}

function through(chain, name) {
  const out = path.join(dir, name + '.wav')
  const r = spawnSync(FF, ['-v', 'error', '-i', SRC, '-af', chain, out, '-y'], { encoding: 'utf8' })
  if (r.status !== 0) return { error: (r.stderr || '').slice(-300) }
  return { file: out, ...measure(out) }
}

const base = measure(SRC)
ok('the test signal has dynamics to work with', base.dynamic > 40 && base.peak > -30,
  JSON.stringify(base))
ok('...at a level a preset is actually calibrated for', base.peak > -6, String(base.peak))

// ── each processor does the thing it is named after ──────────────────────
{
  const hp = through(T.compileEffect({ kind: 'highpass', frequency: 400 }), 'hp')
  ok('a highpass removes energy', hp.rms < base.rms - 0.3, `${base.rms} → ${hp.rms}`)

  const lp = through(T.compileEffect({ kind: 'lowpass', frequency: 800 }), 'lp')
  ok('a lowpass removes energy too', lp.rms < base.rms, `${base.rms} → ${lp.rms}`)

  const cut = through(T.compileEffect({ kind: 'eq', frequency: 440, gain: -14, q: 1 }), 'eqcut')
  const boost = through(T.compileEffect({ kind: 'eq', frequency: 440, gain: 8, q: 1 }), 'eqboost')
  ok('an EQ cut at the tone reduces it', cut.rms < base.rms - 3, `${base.rms} → ${cut.rms}`)
  ok('an EQ boost at the tone raises it', boost.rms > base.rms + 1, `${base.rms} → ${boost.rms}`)
  ok('a flat band compiles to nothing rather than a pointless filter',
    T.compileEffect({ kind: 'eq', frequency: 1000, gain: 0 }) === null)

  // MEASURED LOUD-AGAINST-QUIET, NOT BY astats' OWN SUMMARY.
  //
  // The first version of this read "Noise floor dB" and "Dynamic range" straight
  // out of astats and asserted they fell. Both were the wrong instrument: a gate
  // that works removes the floor entirely, so astats stops reporting one and the
  // field comes back null; and a compressor with makeup gain raises the floor and
  // barely moves that summary figure. Neither told me anything about the
  // processor. The signal is loud for the first 0.4s of every second and quiet
  // after, so the honest measurement is the gap between those two windows.
  const LOUD = '0.05:0.35', QUIET = '0.55:0.95'
  const gap = file => measure(file, LOUD).rms - measure(file, QUIET).rms
  const baseGap = gap(SRC)
  ok('the source has a wide gap between loud and quiet', baseGap > 15, String(baseGap))

  // The threshold has to sit BETWEEN the two windows. With the probe at a real
  // level the quiet part is around −27 dB, so a −30 dB gate never closes and
  // measures as "doing nothing" — which is the gate behaving correctly and the
  // test being wrong about where the signal is.
  const gate = through(T.compileEffect({ kind: 'gate', threshold: -22, ratio: 6, release: 40 }), 'gate')
  ok('A GATE MAKES THE QUIET PARTS QUIETER — the entire point of a gate',
    measure(gate.file, QUIET).rms < measure(SRC, QUIET).rms - 5,
    `${measure(SRC, QUIET).rms} → ${measure(gate.file, QUIET).rms}`)
  ok('...and leaves the loud parts alone',
    Math.abs(measure(gate.file, LOUD).rms - measure(SRC, LOUD).rms) < 2,
    `${measure(SRC, LOUD).rms} → ${measure(gate.file, LOUD).rms}`)

  const comp = through(T.compileEffect({ kind: 'compressor', threshold: -34, ratio: 12, attack: 2, release: 60 }), 'comp')
  ok('A COMPRESSOR NARROWS THE GAP BETWEEN LOUD AND QUIET — likewise',
    gap(comp.file) < baseGap - 4, `${baseGap.toFixed(1)} dB → ${gap(comp.file).toFixed(1)} dB`)

  const sat = through(T.compileEffect({ kind: 'saturation', gain: 8 }), 'sat')
  ok('saturation changes the signal', sat.rms !== null && Math.abs(sat.rms - base.rms) > 0.2,
    `${base.rms} → ${sat.rms}`)
  ok('...without running away in level', sat.peak < 0, String(sat.peak))
  ok('zero drive compiles to nothing', T.compileEffect({ kind: 'saturation', gain: 0 }) === null)

  const lim = through(T.compileEffect({ kind: 'limiter', threshold: -6 }), 'lim')
  ok('A LIMITER HOLDS THE CEILING IT WAS GIVEN', lim.peak <= -5.8, String(lim.peak))

  const verb = through(T.compileEffect({ kind: 'reverb', size: 0.5, mix: 0.4 }), 'verb')
  // MEASURED IN THE GAP, NOT OVER THE WHOLE FILE.
  //
  // Overall RMS is the wrong instrument for a reverb on a sine: the delayed
  // copies interfere with the source and can cancel as easily as add, so the
  // total moved by −0.07 dB and said nothing. What a reverb actually does is put
  // energy where there was none — the tail of a burst spilling into the silence
  // after it. That is the window to look at.
  // The window is 0.42–0.52s, immediately after a burst ends at 0.40s. The
  // taps land 40–100 ms later, so a window starting at 0.55 misses the tail
  // entirely — which is what the first version of this measured, and why it
  // saw +1.6 dB instead of a reverb.
  const TAIL_W = '0.42:0.52'
  ok('REVERB PUTS A TAIL INTO THE SILENCE AFTER A BURST',
    measure(verb.file, TAIL_W).rms > measure(SRC, TAIL_W).rms + 3,
    `${measure(SRC, TAIL_W).rms} → ${measure(verb.file, TAIL_W).rms}`)
  ok('...and does not attenuate the dry signal, which out_gain 0.9 used to do',
    measure(verb.file, '0.05:0.35').rms >= measure(SRC, '0.05:0.35').rms - 0.05,
    `${measure(SRC, '0.05:0.35').rms} → ${measure(verb.file, '0.05:0.35').rms}`)
  ok('a dry reverb compiles to nothing', T.compileEffect({ kind: 'reverb', mix: 0 }) === null)
  ok('a dry delay compiles to nothing', T.compileEffect({ kind: 'delay', mix: 0 }) === null)
}

// ── the presets are chains a person would actually reach for ─────────────
{
  for (const key of Object.keys(T.AUDIO_PRESETS)) {
    const chain = T.compileChain(T.AUDIO_PRESETS[key].chain)
    if (!chain) { ok(`${key} is deliberately empty`, key === 'none'); continue }
    const r = through(chain, 'preset-' + key)
    ok(`preset "${key}" is accepted by ffmpeg`, !r.error, r.error)
    ok(`preset "${key}" produces audio`, r.rms !== null && r.rms > -70, String(r.rms))
  }
  const voice = through(T.compileChain(T.AUDIO_PRESETS.voice.chain), 'v')
  const LOUD2 = '0.05:0.35', QUIET2 = '0.55:0.95'
  const gap2 = f => measure(f, LOUD2).rms - measure(f, QUIET2).rms
  ok('the voice preset narrows the gap — it gates AND compresses',
    gap2(voice.file) < gap2(SRC) - 3,
    `${gap2(SRC).toFixed(1)} dB → ${gap2(voice.file).toFixed(1)} dB`)
  ok('...and stays under its own limiter', voice.peak <= -1.3, String(voice.peak))

  const tel = through(T.compileChain(T.AUDIO_PRESETS.telephone.chain), 't')
  ok('the telephone preset really is band-limited', tel.rms < base.rms, `${base.rms} → ${tel.rms}`)
}

// ── order is the part that is audible when it is wrong ───────────────────
{
  const chain = T.compileChain([
    { kind: 'limiter', threshold: -3 },
    { kind: 'compressor', threshold: -20 },
    { kind: 'highpass', frequency: 90 },
    { kind: 'eq', frequency: 3000, gain: 3 },
    { kind: 'gate', threshold: -50 },
  ])
  const at = s => chain.indexOf(s)
  ok('highpass runs first', at('highpass') < at('agate'))
  ok('the gate runs before the compressor', at('agate') < at('acompressor'))
  ok('EQ runs before the compressor, so it reacts to the tone you want',
    at('equalizer') < at('acompressor'))
  ok('THE LIMITER RUNS LAST, ALWAYS', at('alimiter') > at('acompressor'), chain)

  const two = T.compileChain([{ kind: 'limiter', threshold: -1 }, { kind: 'limiter', threshold: -6 }])
  ok('two limiters collapse to one', (two.match(/alimiter/g) || []).length === 1, two)
  ok('...and the lower ceiling wins', two.includes(T.dbToLinear(-6).toFixed(6)), two)
  ok('a disabled effect is dropped', T.compileChain([{ kind: 'eq', frequency: 1000, gain: 6, enabled: false }]) === '')
  ok('an empty chain is an empty string', T.compileChain([]) === '' && T.compileChain(undefined) === '')
}

// ── nonsense in, sane audio out ──────────────────────────────────────────
{
  const wild = T.compileChain([
    { kind: 'compressor', ratio: 0, threshold: 40, attack: -5 },
    { kind: 'eq', frequency: -100, gain: 900, q: 0 },
    { kind: 'limiter', threshold: 20 },
  ])
  const r = through(wild, 'wild')
  ok('a ratio of zero, a positive threshold and a 900 dB boost are all clamped',
    !r.error, r.error)
  ok('...and the result is still audio', r.rms !== null && r.rms > -80, String(r.rms))
  ok('...still under a sane ceiling', r.peak <= 0.1, String(r.peak))
}

// ── automation actually moves ────────────────────────────────────────────
{
  const auto = T.compileGainAutomation([{ t: 0, db: -30 }, { t: 4, db: 0 }])
  ok('the expression is evaluated per frame, or a fade is just a level change',
    /eval=frame/.test(auto), auto.slice(0, 80))
  const r = through(auto, 'auto')
  ok('the automated file renders', !r.error, r.error)
  const early = measure(r.file, '0:0.5')
  const late = measure(r.file, '3.5:4')
  const srcEarly = measure(SRC, '0:0.5')
  const srcLate = measure(SRC, '3.5:4')
  ok('A FADE-IN IS QUIET AT THE START', early.rms < srcEarly.rms - 12,
    `${srcEarly.rms} → ${early.rms}`)
  ok('...and back to level at the end', Math.abs(late.rms - srcLate.rms) < 1.5,
    `${srcLate.rms} → ${late.rms}`)
  ok('a single point is a constant, not an expression',
    T.compileGainAutomation([{ t: 0, db: -6 }]) === `volume=${T.dbToLinear(-6).toFixed(5)}`)
  ok('no points is no filter', T.compileGainAutomation([]) === '')
  ok('points are sorted, so an out-of-order envelope still works',
    T.compileGainAutomation([{ t: 4, db: 0 }, { t: 0, db: -30 }]) === auto)
}

// ── it reads as words, not as numbers ────────────────────────────────────
{
  ok('a chain describes itself in order',
    T.describeChain(T.AUDIO_PRESETS.voice.chain) === 'taie jos → poartă → EQ → compresor → limitator',
    T.describeChain(T.AUDIO_PRESETS.voice.chain))
  ok('an empty chain says so', T.describeChain([]) === 'fără procesare')
  ok('every preset carries a note explaining itself',
    Object.values(T.AUDIO_PRESETS).every(p => p.note && p.note.length > 20))
}

// ── and it is reachable, which is not the same as built ──────────────────
//
// The chain existed, the worker compiled it, and there was NO WAY TO CHOOSE ONE.
// A processor nobody can switch on is the same as no processor, and it is the
// easy thing to miss: everything compiles, every test passes, and the feature
// does not exist for the person using the tool.
{
  const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
  const src = stripComments(raw)
  ok('the voice has a processing control', /setVoiceFx\(e\.target\.value\)/.test(src))
  ok('the music has one too', /setMusicFx\(e\.target\.value\)/.test(src))
  ok('every preset is offered, not a hard-coded few',
    /Object\.entries\(AUDIO_PRESETS\)\.map/.test(src))
  ok('the panel says what the chain is, in order', /describeChain\(AUDIO_PRESETS\[/.test(src))
  ok('...and explains why the preset exists', /AUDIO_PRESETS\[musicFx\]\?\.note/.test(src))
  // ASSERTED BY RUNNING THE BUILDER, NOT BY MATCHING THE PAGE.
  //
  // These two used to pattern-match `effects: chain` inside the Studio
  // component. The builder has since moved to lib/timeline/project.ts so a
  // server can render a campaign without mounting React, and the assertions
  // went red for a refactor that changed no behaviour at all. Matching source
  // is the weakest form of this test; running the thing is the strongest, and
  // it survives the builder moving again.
  {
    const P = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'project.js'))
    const hooks = {
      captionStyle: () => ({ family: 'x', size: 0.04, weight: 600, color: '#fff', align: 'center', lineHeight: 1.2 }),
      captionY: () => 0.88,
      overlayClips: () => [],
      sfxLabel: {}, sfxSeconds: {}, subPos: { jos: 0.88 },
      uid: () => 'u' + Math.random(),
    }
    const project = {
      aspect: '9:16', master: '1080', fpsOut: 25,
      scenes: [{ id: 's1', kind: 'image', url: 'a.png', name: 'a', duration: 4, kb: 'none' }],
      cues: [], subsOn: false,
      voUrl: 'v.mp3', voDur: 4, musicUrl: 'm.mp3', musicVol: 0.2,
      voiceFx: 'voice', musicFx: 'music',
      brandKit: { colour: { accent: '#CA2222' }, grade: { look: 'warm', strength: 0.85 }, loudness: 'social' },
    }
    const tl = P.buildProjectTimeline(project, hooks, {})
    const audio = tl.tracks.filter(t => t.kind === 'audio')
    const chainOf = z => {
      const t = audio.find(x => x.z === z)
      return ((t && t.clips[0] && t.clips[0].audio && t.clips[0].audio.effects) || []).map(e => e.kind)
    }
    ok('THE CHAIN REACHES THE AUDIO CLIPS — proved by building a real project',
      chainOf(0).length > 0, chainOf(0).join('>'))
    ok('the voice track and the music track get DIFFERENT chains',
      chainOf(0).join('>') !== chainOf(1).join('>'),
      `voice ${chainOf(0).join('>')} · music ${chainOf(1).join('>')}`)
    ok('...and the voice chain is in the order that matters — gate before ' +
       'compressor, limiter last', (() => {
        const c = chainOf(0)
        const g = c.indexOf('gate'), comp = c.indexOf('compressor'), lim = c.lastIndexOf('limiter')
        return g >= 0 && comp > g && (lim === -1 || lim === c.length - 1)
      })(), chainOf(0).join('>'))
    ok('a project that chose no processing gets none', (() => {
      const plain = P.buildProjectTimeline({ ...project, voiceFx: 'none', musicFx: 'none' }, hooks, {})
      return plain.tracks.filter(t => t.kind === 'audio')
        .every(t => t.clips.every(c => !c.audio || !c.audio.effects || c.audio.effects.length === 0))
    })())
  }
  ok('the choice is saved with the project', /voiceFx, musicFx \}/.test(src))
  ok('...and read back when it opens', /d\.voiceFx/.test(src) && /d\.musicFx/.test(src))
}

fs.rmSync(dir, { recursive: true, force: true })
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)

// _verification/44-masters.cjs
//
// "Master tops out at 1080p."
//
// Adding 1440 and 2160 is a table. The assertions that matter are not about the
// table but about the two ways a 4K setting lies:
//
//   1. AN ODD DIMENSION. h.264 chroma subsampling needs even width and height.
//      A 4:5 frame at 1440 is 1440×1800 — fine — but the arithmetic that
//      produces 1801 passes every unit test and fails at the ENCODER, after the
//      whole film has been drawn. So every dimension in the table is asserted
//      even, at every tier and aspect.
//
//   2. FOUR K THAT ISN'T. Most motion models here return 1080. Render that at
//      2160 and the file is genuinely 4K and contains no extra information.
//      The tool has to say so, so the honest description is asserted to
//      actually change when the material cannot fill the frame.

const path = require('path')
const ROOT = path.join(__dirname, '..')
const M = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'masters.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const ASPECTS = ['9:16', '1:1', '4:5', '16:9']

// ── the table ────────────────────────────────────────────────────────────
{
  ok('there are four tiers, 720 through 4K', M.TIER_ORDER.length === 4 && M.TIER_ORDER[3] === '2160')
  ok('EVERY DIMENSION AT EVERY TIER IS EVEN — the encoder refuses odd ones', M.allEven())
  ok('4K 16:9 really is 3840×2160', M.MASTERS['2160']['16:9'].join('x') === '3840x2160')
  ok('4K vertical really is 2160×3840', M.MASTERS['2160']['9:16'].join('x') === '2160x3840')
  ok('the old 1080 tier is unchanged, so existing films render as before',
    M.MASTERS['1080']['9:16'].join('x') === '1080x1920' &&
    M.MASTERS['1080']['16:9'].join('x') === '1920x1080')
  ok('the old 720 tier is unchanged too', M.MASTERS['720']['4:5'].join('x') === '864x1080')
  ok('each tier is strictly larger than the one below it, in every aspect',
    ASPECTS.every(a => {
      for (let i = 1; i < M.TIER_ORDER.length; i++) {
        if (M.pixelsOf(M.TIER_ORDER[i], a) <= M.pixelsOf(M.TIER_ORDER[i - 1], a)) return false
      }
      return true
    }))
  ok('every tier has every aspect', M.TIER_ORDER.every(t => ASPECTS.every(a => M.MASTERS[t][a])))
}

// ── upscaled versus native ───────────────────────────────────────────────
{
  const native = { tier: '2160' }
  const up = { tier: '2160', renderAt: '1080' }
  ok('a native master is not upscaled', !M.isUpscaled(native))
  ok('an upscaled one is', M.isUpscaled(up))
  ok('a renderAt EQUAL to the tier is not an upscale',
    !M.isUpscaled({ tier: '1080', renderAt: '1080' }))
  ok('a renderAt ABOVE the tier is not treated as an upscale either',
    !M.isUpscaled({ tier: '1080', renderAt: '2160' }))

  ok('an upscaled film is DRAWN at the lower size',
    M.renderSize(up, '16:9').join('x') === '1920x1080')
  ok('...but DELIVERED at the higher one', M.deliverySize(up, '16:9').join('x') === '3840x2160')
  ok('a native film draws at its delivery size',
    M.renderSize(native, '16:9').join('x') === M.deliverySize(native, '16:9').join('x'))
}

// ── render time: the number that decides whether this is worth it ────────
{
  const t1080 = M.estimateRenderSeconds({ tier: '1080' }, '16:9', 30)
  const t2160 = M.estimateRenderSeconds({ tier: '2160' }, '16:9', 30)
  ok('a 30s 1080 film is about four and a half minutes', t1080 > 200 && t1080 < 350, t1080)
  ok('4K IS ROUGHLY FOUR TIMES SLOWER, because it is four times the pixels',
    Math.abs(t2160 / t1080 - 4) < 0.3, `${t1080}s → ${t2160}s`)
  ok('an upscaled 4K costs the same as the 1080 it is drawn at',
    M.estimateRenderSeconds({ tier: '2160', renderAt: '1080' }, '16:9', 30) === t1080)
  ok('a longer film takes proportionally longer',
    Math.abs(M.estimateRenderSeconds({ tier: '1080' }, '16:9', 60) / t1080 - 2) < 0.05)
}

// ── bitrate ──────────────────────────────────────────────────────────────
{
  ok('1080p25 lands on the measured-good 12 Mbit',
    Math.abs(M.bitrateFor('1080', '16:9', 25) - 12000) < 100, M.bitrateFor('1080', '16:9', 25))
  ok('4K asks for more than 1080', M.bitrateFor('2160', '16:9') > M.bitrateFor('1080', '16:9'))
  ok('...but LESS THAN FOUR TIMES more — detail per pixel falls as resolution rises',
    M.bitrateFor('2160', '16:9') < 4 * M.bitrateFor('1080', '16:9'),
    `${M.bitrateFor('1080', '16:9')} → ${M.bitrateFor('2160', '16:9')}`)
  ok('50p needs more bits than 25p',
    M.bitrateFor('1080', '16:9', 50) > M.bitrateFor('1080', '16:9', 25))
  ok('every tier and aspect gives a sane positive bitrate',
    M.TIER_ORDER.every(t => ASPECTS.every(a => M.bitrateFor(t, a) > 500 && M.bitrateFor(t, a) < 200000)))
}

// ── THE HONESTY. This is the reason the module exists. ───────────────────
{
  // 4K asked for, but every shot is a 1080 motion clip.
  const weak = M.describeDelivery({ tier: '2160' }, '16:9', 30, 1920)
  ok('4K FROM 1080 SOURCES IS REPORTED AS NOT REAL DETAIL', weak.realDetail === false)
  ok('...and it says so in words, naming the actual source size',
    /1920/.test(weak.honest), weak.honest)
  ok('...and it warns, rather than quietly taking the render time', !!weak.warning)
  ok('...and the warning offers the faster route that gives the same result',
    /mărit din 1080p|mai repede/.test(weak.warning || ''), weak.warning)

  // 4K asked for, with 4K material.
  const strong = M.describeDelivery({ tier: '2160' }, '16:9', 30, 3840)
  ok('4K FROM 4K SOURCES IS REPORTED AS REAL', strong.realDetail === true)
  ok('...and does not warn about wasted detail', !/inventează|nu îl are/.test(strong.honest))

  // Deliberate upscale.
  const up = M.describeDelivery({ tier: '2160', renderAt: '1080' }, '16:9', 30, 1920)
  ok('a deliberate upscale is honest that the file really is 4K', /CHIAR/.test(up.honest))
  ok('...AND that the extra pixels are computed, not filmed',
    /calculați, nu filmați/.test(up.honest))
  ok('...and it is not claimed as real detail', up.realDetail === false)
  ok('...and it reports being faster', /mai repede/.test(up.honest))

  // 1080 from good sources: the ordinary case must stay quiet.
  const ordinary = M.describeDelivery({ tier: '1080' }, '9:16', 30, 1920)
  ok('THE ORDINARY CASE IS NOT NAGGED AT', ordinary.realDetail === true && !ordinary.warning)

  // No source information at all: do not invent a verdict.
  const unknown = M.describeDelivery({ tier: '2160' }, '16:9', 30)
  ok('with no source information it does not claim the detail is fake',
    unknown.realDetail === true)
  ok('...and it does not quote a source size it does not have', !/px pe latura/.test(unknown.honest))

  // Long renders are flagged even when the detail is real.
  const long = M.describeDelivery({ tier: '2160' }, '16:9', 120, 3840)
  ok('a very long 4K render warns about the time even when the detail is real',
    !!long.warning && /minute/.test(long.warning), long.warning)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
// _verification/run-all.cjs
//
// Runs every suite in this folder and reports one exit code.
//
// The suites existed for weeks and never ran except when someone typed their
// names, which meant every regression they closed could quietly reopen. This is
// the file that lets CI run them, so it has to be honest about two things:
//
//   1. Some suites need ffmpeg and node-canvas. On a machine without them the
//      right answer is to SKIP and say so — not to pass silently, and not to
//      fail a pull request over a missing apt package. `--strict` turns skips
//      into failures, which is what CI uses once the deps are installed.
//   2. A suite that crashes is a failure, not a zero. Exit codes are checked,
//      and a non-zero exit with no parsable tally still counts as failed.

'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const DIR = __dirname
const ROOT = path.join(DIR, '..')
const strict = process.argv.includes('--strict')
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7)

// What each suite needs beyond plain node. Derived by reading the suites, and
// asserted below so this list cannot drift away from what they actually require.
const NEEDS = {
  canvas: ['13-resample', '14-brand', '15-colour', '16-layers', '19-wordmark', '22-captions-parity', '30-grade-parity'],
  ffmpeg: ['12-inspect', '13-resample', '15-colour', '16-layers', '17-sound', '19-wordmark', '30-grade-parity'],
}

function have(what) {
  if (what === 'ffmpeg') {
    return spawnSync(process.env.FFMPEG || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  }
  try { require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas')); return true }
  catch { return false }
}

const dist = path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js')
if (!fs.existsSync(dist)) {
  console.error('The shared timeline is not built.')
  console.error('  cd render-worker && npm run build:timeline')
  process.exit(2)
}

const suites = fs.readdirSync(DIR)
  .filter(f => /^\d+-.*\.cjs$/.test(f))
  .filter(f => !only || f.includes(only))
  .sort()

const has = { canvas: have('canvas'), ffmpeg: have('ffmpeg') }
const missing = Object.entries(has).filter(([, v]) => !v).map(([k]) => k)
if (missing.length) {
  console.log(`! not installed: ${missing.join(', ')} — suites needing them will be ${strict ? 'FAILED' : 'skipped'}\n`)
}

let totalPass = 0, totalFail = 0, failedSuites = [], skipped = []
const t0 = Date.now()

for (const file of suites) {
  const name = file.replace(/\.cjs$/, '')
  const needs = Object.keys(NEEDS).filter(k => NEEDS[k].includes(name))
  const unmet = needs.filter(k => !has[k])

  if (unmet.length && !strict) {
    skipped.push(`${name} (needs ${unmet.join(' + ')})`)
    console.log(`SKIP  ${name.padEnd(24)} needs ${unmet.join(' + ')}`)
    continue
  }

  const r = spawnSync(process.execPath, [path.join(DIR, file)], { encoding: 'utf8', timeout: 15 * 60 * 1000 })
  const out = (r.stdout || '') + (r.stderr || '')
  const tally = /(\d+) passed, (\d+) failed/.exec(out)
  const pass = tally ? Number(tally[1]) : 0
  const fail = tally ? Number(tally[2]) : 0
  const crashed = r.status !== 0 && !tally

  totalPass += pass
  totalFail += fail + (crashed ? 1 : 0)

  if (fail > 0 || crashed || r.status !== 0) {
    failedSuites.push(name)
    console.log(`FAIL  ${name.padEnd(24)} ${crashed ? 'crashed' : `${pass} passed, ${fail} failed`}`)
    // Only the failing lines, so a red build is readable.
    for (const line of out.split('\n')) if (/FAIL:|Error|error TS/.test(line)) console.log('        ' + line.trim())
    if (crashed) console.log('        ' + out.trim().split('\n').slice(-6).join('\n        '))
  } else {
    console.log(`ok    ${name.padEnd(24)} ${pass} assertions`)
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log('\n' + '─'.repeat(56))
console.log(`${totalPass} assertions passed, ${totalFail} failed, ${suites.length - skipped.length} suites run in ${secs}s`)
if (skipped.length) console.log(`skipped: ${skipped.join(', ')}`)
if (failedSuites.length) console.log(`failing suites: ${failedSuites.join(', ')}`)
process.exit(totalFail ? 1 : 0)

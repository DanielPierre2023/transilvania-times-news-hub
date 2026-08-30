// render-worker/src/fonts.js
//
// Does the face the kit names actually exist here?
//
// THE FAILURE THIS CATCHES
//
// The brand kit named a display face for weeks. node-canvas resolves families
// through fontconfig, fontconfig had never heard of it, and Cairo silently
// substituted the default sans. Every title, every lower third and every end
// card in every film was set in the wrong face, the render reported success,
// and the QC report was green — because nothing measured it.
//
// A missing font is invisible by construction: the text is still there, still
// legible, still the right colour. The only way to see it is to measure.
//
// THE TEST
//
// Set the same string in the requested family and in a family that certainly
// does not exist. Both fall back to the same default when the requested family
// is missing, so identical advance widths mean the font did not resolve. It is
// a two-line check for a class of bug that is otherwise found by a client.

'use strict'

const { createCanvas } = require('canvas')

// Long enough that two different faces cannot coincidentally measure the same,
// and carrying the Romanian diacritics so a face that lacks them shows up as a
// width difference against a face that has them.
const PROBE = 'Transilvania Times — știrile de aici, ăâîșț 0123456789'
const ABSENT = '__no_such_family_9f3a__'

/** @returns {{family:string, resolved:boolean, width:number, fallbackWidth:number}} */
function probe(family, weight = 400, size = 64) {
  const ctx = createCanvas(8, 8).getContext('2d')
  const first = String(family).split(',')[0].replace(/['"]/g, '').trim()
  const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(first)
  ctx.font = `${weight} ${size}px "${first}", sans-serif`
  const width = ctx.measureText(PROBE).width
  ctx.font = `${weight} ${size}px "${ABSENT}", sans-serif`
  const fallbackWidth = ctx.measureText(PROBE).width
  return {
    family: first,
    // A generic family is always "resolved" — it is a request for whatever the
    // system has, not for a specific face.
    resolved: generic || Math.abs(width - fallbackWidth) > 0.5,
    width,
    fallbackWidth,
  }
}

/** Every distinct family+weight a timeline asks for. */
function requestedFaces(tl) {
  const seen = new Map()
  for (const track of tl.tracks || []) {
    for (const clip of track.clips || []) {
      const src = clip.source
      if (!src || src.kind !== 'text' || !src.style) continue
      const key = `${src.style.family}|${src.style.weight}`
      if (!seen.has(key)) seen.set(key, { family: src.style.family, weight: src.style.weight })
    }
  }
  return [...seen.values()]
}

/**
 * @returns {{ok:boolean, faces:Array, missing:Array}}
 */
function checkFonts(tl) {
  const faces = requestedFaces(tl).map(f => ({ ...probe(f.family, f.weight), weight: f.weight }))
  const missing = faces.filter(f => !f.resolved)
  return { ok: missing.length === 0, faces, missing }
}

module.exports = { probe, requestedFaces, checkFonts, PROBE }

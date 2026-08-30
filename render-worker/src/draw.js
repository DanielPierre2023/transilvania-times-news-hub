// render-worker/src/draw.js
//
// The worker's drawing is now the SHARED drawing.
//
// This file used to hold its own copy of the text wrapping, the caption plate
// and the bitmap draw, while the Studio preview held another. They agreed only
// by luck, and every typographic feature — a letter-spaced kicker, a title that
// may run to three lines, a rule with a real thickness — would have had to be
// written twice and would have drifted the first time one was fixed alone.
//
// lib/timeline/draw.ts is the one implementation. The Dockerfile compiles it
// into dist/timeline alongside the rest of the module, so the browser and the
// renderer cannot read different versions of it.

'use strict'

const timeline = require('./timeline')

module.exports = {
  drawFrame: timeline.drawFrame,
  wrapText: timeline.wrapText,
}

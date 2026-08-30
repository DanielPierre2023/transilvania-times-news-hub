// render-worker/src/timeline.js
//
// The compiled lib/timeline module. The worker and the browser read the SAME
// timeline code — that is what stops the preview and the render drifting apart.
// The Dockerfile compiles lib/timeline/*.ts into dist/ during the build.

'use strict'

const path = require('path')

const distPath = process.env.TIMELINE_DIST || path.join(__dirname, '..', 'dist', 'timeline', 'index.js')

module.exports = require(distPath)

// _verification/lib/source.cjs
//
// Reading a source file for assertions, without lying about what is in it.
//
// Suites inspect the Studio page as text so that a commented-out line cannot
// satisfy an assertion. Every one of them stripped comments with the obvious
// regex:
//
//     src.replace(/\/\*[\s\S]*?\*\//g, '')
//
// which is wrong, and wrong in a way that hides for a long time. `/*` is not
// only how a block comment opens; it also appears inside perfectly ordinary
// strings. This codebase has `accept="image/*"` and `accept="video/*"` on its
// file inputs, so the strip ran from a MIME filter in the markup to the next
// `*/` hundreds of lines later.
//
// MEASURED, on app/admin/studio/page.tsx: the regex removed 7,162 characters
// MORE than a correct scanner does — seven thousand characters of real code
// that eighteen suites were therefore asserting against without seeing.
//
// Those suites passed, which is the point. An assertion cannot fail on code it
// cannot see; it can only fail to protect it. The next assertion written about
// anything in those seven thousand characters would have failed for a reason
// nobody could find.
//
// So: a scanner that knows what a string is. Longer than a regex, and correct.

const fs = require('fs')

/** Strip comments, respecting string and template literals. */
function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i], d = src[i + 1]

    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += c
      i++
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
      // A space, not nothing: two tokens either side of a comment must not be
      // glued into one, or `a/* x */b` becomes the identifier `ab`.
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

/** The file as written, and the file with comments removed. */
function read(file) {
  const raw = fs.readFileSync(file, 'utf8')
  return { raw, src: stripComments(raw) }
}

module.exports = { read, stripComments }

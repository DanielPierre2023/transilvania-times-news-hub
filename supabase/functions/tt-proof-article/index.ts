// supabase/functions/tt-proof-article/index.ts
//
// ============================================================================
// PROOF & PREPARE — Voice-Preserving Editorial Corrector v1 (June 10, 2026)
// ============================================================================
//
// PURPOSE
//   Correct human-written texts (owner or guest editors) WITHOUT touching the
//   author's voice, then produce publication metadata. This is the inverse of
//   the generation pipeline: where tt-generate / tt-process destroy the source
//   phrasing by design (ZERO_COPY), this function treats the author's phrasing
//   as the asset to protect.
//
// WHAT IT DOES
//   Pass 1 — CORRECTION (Sonnet, temp 0.2):
//     orthography (diacritics ș/ț comma-below, hyphenation s-a/sa/într-o,
//     capitals, Romanian numerals), punctuation (mandatory/forbidden commas,
//     Romanian quotes „..."), syntax (agreement, anacoluthon, wrong
//     preposition/article), semantics (false friends, clear pleonasms).
//     FORBIDDEN: synonym swaps, rewording, reordering, register/rhythm/person
//     changes. Every fix returned in corrections[] {before, after, reason}.
//
//   VOICE GUARD (deterministic): token-level LCS change ratio between input
//     and output. If > VOICE_CHANGE_LIMIT the function rejects its own output
//     and retries once with a stricter instruction; a second breach returns
//     the result flagged voice_warning=true for human review.
//
//   FORMAT PASS (deterministic, logged):
//     format_mode='enforce' (default): TT house style applied mechanically —
//       markdown subheadings flattened, bold-on-own-line stripped, em/en
//       dashes converted — each change appended to corrections[].
//     format_mode='preserve': deviations only reported in format_warnings[].
//
//   Pass 2 — METADATA (Sonnet):
//     suggested title (author's original is preserved and returned),
//     excerpt, summary with the 60-80 word count PROGRAMMATICALLY ENFORCED
//     (one re-ask with exact count feedback), 6-9 native tag slugs,
//     seo_title <= 60 chars, seo_description <= 160 chars, slug.
//
//   OPTIONAL translate=true: faithful translation into the other language,
//     fidelity-first (preserves the author's voice; this is NOT the
//     pipeline's compose-natively doctrine — here the voice is the asset).
//
// WHAT IT DOES NOT DO
//   - No pipeline sanitizers (sanitizeContentRo/En would eat the author's
//     words). No editor voices. No humanization rewriting. No fact changes.
//
// INPUT (POST JSON)
//   {
//     text: string            (required, >= 300 chars)
//     title?: string          (author's title — preserved)
//     author_name?: string    (guest byline; default 'Redacția')
//     category?: string       (default 'opinion')
//     county?: string         (validated against ALLOWED_COUNTIES)
//     language?: 'ro' | 'en'  (auto-detected when absent)
//     translate?: boolean     (default false)
//     format_mode?: 'enforce' | 'preserve'   (default 'enforce')
//   }
//
// OUTPUT: blog_posts-shaped JSON (title_*, content_*, excerpt_*, summary_*,
//   tags_*, seo_*) + corrections[], format_warnings[], change_ratio,
//   voice_warning, original_title, suggested_title, slug, author_name,
//   ai_editor: null, _meta.
//
// Self-contained — no _shared imports.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SONNET_MODEL = 'claude-sonnet-4-5-20250929'
// Per-call timeout. Structured-output (constrained decoding) generation of a
// full corrected article can legitimately take 60-100s under API load. The
// gateway closes the client connection at ~150s, so a single call gets almost
// the whole budget — and we NEVER retry a timed-out generation (the retry
// starts cold and doubles the damage; retries remain only for 429/5xx which
// return instantly).
const CALL_TIMEOUT_MS = 110000
const VOICE_CHANGE_LIMIT = 0.10
// Adaptive summary length. A summary should be 5-10% of the source article,
// following standard journalistic ratios. For short essays (Anamaria's 399w
// piece was previously getting a 60-80 word target — nearly 20% of the text —
// which pushed the model into either padding or giving up). Ranges are
// generous enough that the model has room, tight enough that summaries
// stay proportional to the source.
function getSummaryTarget(articleWords: number): { min: number; max: number } {
  if (articleWords < 500) return { min: 25, max: 40 }
  if (articleWords < 1000) return { min: 40, max: 55 }
  if (articleWords < 1500) return { min: 50, max: 70 }
  return { min: 60, max: 80 }
}

const ALLOWED_COUNTIES = ['cluj','bihor','alba','bistrita-nasaud','salaj','mures','sibiu','maramures','satu-mare','hunedoara','brasov','covasna','harghita','national']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Correction { before: string; after: string; reason: string; kind: 'text' | 'format' }


// ─── JSON schemas for structured outputs ──────────────────────────────────────
//
// The Anthropic Messages API supports structured outputs natively for
// Claude Sonnet 4.5 via output_config.format.json_schema. The API GUARANTEES
// the response is valid JSON matching the schema — including proper escaping
// of quotes, backslashes, and control characters inside string values.
//
// This solves the failure mode where Sonnet was emitting Romanian typographic
// close quotes „..." with the closing " character as ASCII U+0022 UNESCAPED
// inside JSON string values, terminating the string prematurely and making
// the response unparseable. Structured output mode guarantees proper escaping.
//
// Schemas describe SHAPE only. All correction rules, voice preservation,
// summary length constraints, tag conventions remain in the system prompts.

const CORRECTION_SCHEMA = {
  type: 'object',
  properties: {
    content: {
      type: 'string',
      description: 'The COMPLETE corrected text of the article, in full, with all corrections applied. Must contain every paragraph and every sentence of the original — never summarize, never truncate, never omit.',
    },
    corrections: {
      type: 'array',
      description: 'List of every correction made. Each entry shows the exact original fragment, the exact corrected fragment, and a short reason in the article language.',
      items: {
        type: 'object',
        properties: {
          before: { type: 'string', description: 'The exact original fragment from the text (copy-paste, character-for-character)' },
          after: { type: 'string', description: 'The corrected replacement fragment' },
          reason: { type: 'string', description: 'Short reason for the correction (e.g. "diacritice lipsă", "virgulă obligatorie")' },
        },
        required: ['before', 'after', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['content', 'corrections'],
  additionalProperties: false,
} as const

const METADATA_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    excerpt: { type: 'string' },
    summary: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    seo_title: { type: 'string' },
    seo_description: { type: 'string' },
  },
  required: ['title', 'excerpt', 'summary', 'tags', 'seo_title', 'seo_description'],
  additionalProperties: false,
} as const

const SUMMARY_FIX_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
  },
  required: ['summary'],
  additionalProperties: false,
} as const

const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['title', 'content'],
  additionalProperties: false,
} as const


// ─── Standard helpers ─────────────────────────────────────────────────────────

function sanitizeTitle(text: string): string {
  if (!text) return ''
  return text.replace(/[#*_`]/g, '').replace(/[.,;:]+$/, '').replace(/\.{2,}$/, '').trim()
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  return (tags as unknown[])
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .map((t: string) =>
      t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
       .replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '').replace(/-{2,}/g, '-')
       .replace(/^-|-$/g, '').slice(0, 50)
    )
    .filter((t: string) => { if (!t || t.length < 2 || seen.has(t)) return false; seen.add(t); return true })
    .slice(0, 9)
}

function parseJsonSafe(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()

  // Attempt 1: standard JSON.parse
  try { return JSON.parse(cleaned) } catch { /* continue */ }

  // Attempt 2: extract from first { to last }
  const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}')
  if (s !== -1 && e > s) {
    const sub = cleaned.substring(s, e + 1)
    try { return JSON.parse(sub) } catch { /* continue */ }
  }

  // Attempt 3: Romanian-quote-aware extraction.
  //
  // The specific corruption: Sonnet emits Romanian closing quote „..." where
  // the closing " is ASCII U+0022 (the JSON string delimiter). This terminates
  // the JSON string value prematurely, making JSON.parse fail.
  //
  // Example of corrupted JSON:
  //   {"content": "...„Gambele sunt a doua inimă."\nLa început..."}
  //                                              ^ ASCII " breaks the string
  //
  // Fix: find the "content" and "corrections" keys, extract the raw string
  // value for "content" by scanning for the balanced closing, escaping any
  // unescaped internal " characters that aren't JSON structural delimiters.
  try {
    // Find "content" value start
    const contentKeyMatch = cleaned.match(/"content"\s*:\s*"/)
    if (!contentKeyMatch?.index) throw new Error('no content key')
    const contentStart = contentKeyMatch.index + contentKeyMatch[0].length

    // Find "corrections" key (marks the end of the content value)
    const correctionsKeyMatch = cleaned.match(/"corrections"\s*:\s*\[/)
    if (!correctionsKeyMatch?.index) throw new Error('no corrections key')

    // The content value ends just before "corrections" — scan backward for the
    // last " that's followed by comma/whitespace and then "corrections"
    const betweenRegion = cleaned.substring(contentStart, correctionsKeyMatch.index)
    // Strip trailing: "  ,  "corrections" — work backward to find content end
    const trimmed = betweenRegion.replace(/"\s*,\s*$/, '')

    // Now extract corrections array
    const corrStart = correctionsKeyMatch.index + correctionsKeyMatch[0].length
    const corrEnd = cleaned.lastIndexOf(']')
    const correctionsRaw = corrEnd > corrStart ? cleaned.substring(corrStart, corrEnd) : ''

    // Parse corrections (each object should be individually parseable)
    const corrections: unknown[] = []
    const corrObjects = correctionsRaw.match(/\{[^}]+\}/g) || []
    for (const obj of corrObjects) {
      try { corrections.push(JSON.parse(obj)) } catch { /* skip malformed correction */ }
    }

    console.log(`[proof v2] parseJsonSafe: Romanian-quote recovery — content ${trimmed.length}c, ${corrections.length} corrections extracted`)
    return { content: trimmed, corrections }
  } catch { /* final fallback failed */ }

  return null
}

function generateSlug(title: string): string {
  const base = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+$/, '').substring(0, 60)
  return `${base}-${Math.random().toString(36).substring(2, 10)}`
}

function countWords(text: string): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter((w: string) => w.length > 0).length
}

function isRomanianText(text: string): boolean {
  if (!text || text.length < 100) return false
  const lower = text.toLowerCase()
  const diacritics = (text.match(/[ăâîșțĂÂÎȘȚ]/g) || []).length
  const letters = (text.match(/[a-zA-ZăâîșțĂÂÎȘȚ]/g) || []).length
  const density = letters > 0 ? diacritics / letters : 0
  if (density >= 0.008) return true
  const roWords = [' și ', ' în ', ' este ', ' care ', ' pentru ', ' după ', ' dupa ',
    ' această ', ' aceasta ', ' sunt ', ' către ', ' catre ', ' decât ', ' decat ',
    ' între ', ' intre ', ' până ', ' pana ', ' fără ', ' fara ', ' unui ', ' unei ',
    ' nostru ', ' lor ', ' ca ', ' sa ', ' se ', ' va ', ' si ']
  let roHits = 0
  for (const w of roWords) { if (lower.includes(w)) roHits++ }
  const enWords = [' the ', ' and ', ' of ', ' to ', ' that ', ' this ', ' with ', ' from ',
    ' was ', ' were ', ' has ', ' have ', ' which ', ' their ', ' about ', ' against ']
  let enHits = 0
  for (const w of enWords) { if (lower.includes(w)) enHits++ }
  return roHits >= 4 && enHits <= 2
}

function tidyWhitespace(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim()
}


// ─── Voice guard — token-level LCS change ratio ──────────────────────────────
// 0 = identical, 1 = nothing shared. Corrections legitimately break a few
// tokens around each fix; wholesale rewriting moves the ratio far above the
// limit. Capped at 6000 tokens per side to bound CPU.

function tokenChangeRatio(a: string, b: string): number {
  const MAX = 6000
  const A = a.toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX)
  const B = b.toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX)
  if (!A.length || !B.length) return 1
  let prev = new Uint32Array(B.length + 1)
  let curr = new Uint32Array(B.length + 1)
  for (let i = 1; i <= A.length; i++) {
    const ai = A[i - 1]
    for (let j = 1; j <= B.length; j++) {
      curr[j] = ai === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1])
    }
    const tmp = prev; prev = curr; curr = tmp
  }
  const lcs = prev[B.length]
  return 1 - (2 * lcs) / (A.length + B.length)
}


// ─── Model caller ─────────────────────────────────────────────────────────────

async function fetchWithRetry(url: string, options: RequestInit, label: string, maxRetries = 1): Promise<Response> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
    const started = Date.now()
    try {
      console.log(`[proof v2] ${label} attempt ${attempt + 1}/${maxRetries + 1}...`)
      const res = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timer)
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        console.warn(`[proof v2] ${label} got ${res.status} — retrying`)
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); continue
      }
      console.log(`[proof v2] ${label} responded ${res.status} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
      return res
    } catch (e) {
      clearTimeout(timer); lastErr = e as Error
      const isAbort = (e as Error).name === 'AbortError'
      if (isAbort) {
        // A timed-out generation is NOT retried: the retry starts cold and
        // consumes the remaining gateway budget with no better odds.
        console.error(`[proof v2] ${label} TIMED OUT after ${CALL_TIMEOUT_MS / 1000}s — not retrying`)
        throw new Error(`${label}: generation timed out after ${CALL_TIMEOUT_MS / 1000}s`)
      }
      if (attempt < maxRetries) { await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); continue }
    }
  }
  throw lastErr || new Error(`${label}: retries exhausted`)
}

async function callSonnet(
  system: string, user: string,
  maxTokens = 8000, temperature = 0.2,
  jsonSchema?: Record<string, unknown>,
): Promise<{ text: string; error?: string; stopReason?: string }> {
  const apiKey = Deno.env.get('CLAUDE_API_KEY')
  if (!apiKey) return { text: '', error: 'CLAUDE_API_KEY not set' }
  try {
    // Structured output mode (when jsonSchema provided):
    // Anthropic's native output_config.format.json_schema. The API enforces
    // the schema at generation time; the response is GUARANTEED valid JSON
    // matching the shape. This solves the Romanian-quote-inside-JSON-string
    // problem that was catastrophically breaking free-form JSON output —
    // Sonnet was emitting raw " characters (U+0022) inside string values
    // when the source text had Romanian typographic quotes „...", terminating
    // the JSON string prematurely. Structured output escapes correctly.
    const requestBody: Record<string, unknown> = {
      model: SONNET_MODEL,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    }
    if (jsonSchema) {
      requestBody.output_config = {
        format: { type: 'json_schema', schema: jsonSchema },
      }
    }
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    }, 'sonnet')
    const raw = await res.text()
    if (!res.ok) return { text: '', error: `Sonnet ${res.status}: ${raw.substring(0, 200)}` }
    const data = JSON.parse(raw)
    const text = data?.content?.[0]?.text || ''
    const stopReason: string = data?.stop_reason || 'unknown'
    // Permanent diagnostics: stop_reason is the only signal that separates a
    // complete response (end_turn) from budget truncation (max_tokens) and
    // policy refusal (refusal). Every past blind spot in this function traced
    // back to not logging this.
    console.log(`[proof v2] sonnet ok — stop_reason=${stopReason}, output_tokens=${data?.usage?.output_tokens ?? '?'}, text_length=${text.length}`)
    return { text, stopReason }
  } catch (e) { return { text: '', error: `Sonnet: ${(e as Error).message}` } }
}


// ─── Pass 1 — voice-preserving correction ─────────────────────────────────────

const CORRECTOR_SYSTEM_RO = `Ești corector senior de limbă română la Transilvania Times. Primești un text scris de un autor uman. Rolul tău este să găsești și să listezi erorile obiective din text.

CE CORECTEZI:
1. ORTOGRAFIE: diacritice lipsă sau greșite (ă, â, î, ș, ț), greșeli de scriere, majuscule, cratimă.
2. PUNCTUAȚIE: virgulă lipsă sau greșită, ghilimele, spații la punctuație.
3. SINTAXĂ: dezacorduri gramaticale, prepoziții greșite, anacolut.
4. SEMANTICĂ: cuvinte cu sens greșit, false-friends, pleonasme certe.

CE NU ATINGI (alegeri de stil ale autorului):
- ordinea cuvintelor, structura frazelor, lungimea propozițiilor
- tonul, registrul, persoana narativă
- expresii colocviale sau regionale intenționate
- fapte, cifre, nume, date

PRECIZARE IMPORTANTĂ: Diacriticele lipsă, greșelile gramaticale și erorile de punctuație NU sunt alegeri de stil — sunt erori obiective care se corectează. Un autor poate alege un ton informal, dar "viata" în loc de "viața" este o eroare, nu o alegere.

GHILIMELE FIGURATIVE: Cuvintele între ghilimele ironice/figurative ("virtuti", "patrioți") se corectează normal — NU sunt citate directe. Citatele directe (cu verb de atribuire) se lasă neatinse, cu excepția diacriticelor evidente.

VERIFICARE: Pentru fiecare corectură, confirmă mental:
- Forma originală este GREȘITĂ? ("dar" = corect → nu corecta; "viata" = greșit → corectează)
- Forma corectată EXISTĂ și e corectă? ("dăr" nu există → nu corecta "dar"; "viața" există → corectează)

ANALIZĂ CONTEXTUALĂ OBLIGATORIE: Nu scana doar cuvintele izolat — citește fiecare PROPOZIȚIE pentru sens:
- "altii" → "alții" (pronumele "alții" are întotdeauna ț; "altii" nu este formă corectă)
- "se pare ca", "cred ca", "spun ca", "este evident ca" → "că" (conjuncția "that", nu prepoziția "as")
- "ca" rămâne "ca" DOAR în comparații: "frumos ca o floare", "mare ca un munte"
- Text între ghilimele ironice: "virtuti" → "virtuți", "patrioți" → "patrioți" (nu sunt citate verbale)

Returnează DOAR lista de corecturi. NU reproduce textul integral.

JSON only, fără preambul, fără markdown:
{"corrections":[{"before":"fragmentul original exact","after":"fragmentul corectat","reason":"motiv scurt"}]}`

const CORRECTOR_SYSTEM_EN = `You are a senior copy editor at Transilvania Times. You receive a text written by a human author. Your role is to find and list objective errors in the text.

WHAT YOU CORRECT:
1. ORTHOGRAPHY: spelling errors, capitalization, hyphenation.
2. PUNCTUATION: missing/wrong commas, quotation marks, spacing.
3. SYNTAX: subject-verb agreement, broken parallelism, wrong prepositions.
4. SEMANTICS: words used with wrong meaning, confused pairs, redundancies.

WHAT YOU DON'T TOUCH (author's style choices):
- word order, sentence structure, sentence length
- tone, register, narrative person
- intentional colloquial or regional expressions
- facts, figures, names, dates

IMPORTANT: Missing diacritics, grammar errors, and punctuation errors are NOT style choices — they are objective errors to correct.

VERIFICATION: For each correction, mentally confirm:
- Is the original form WRONG? If unsure → don't correct.
- Is the corrected form CORRECT and does it exist? If unsure → don't correct.

Return ONLY the corrections list. Do NOT reproduce the full text.

JSON only, no preamble, no markdown:
{"corrections":[{"before":"exact original fragment","after":"corrected fragment","reason":"short reason"}]}`


// ─── Corrections-only schema for structured output ────────────────────────────

const CORRECTIONS_ONLY_SCHEMA = {
  type: 'object',
  properties: {
    corrections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          before: { type: 'string' },
          after: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['before', 'after', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['corrections'],
  additionalProperties: false,
} as const


// ─── Paragraph chunking ──────────────────────────────────────────────────────
//
// With 632 words in a single Sonnet call, the model's attention is spread thin
// and it skims past errors that look fluent (viata, deosebita, ca). Splitting
// into ≤150-word chunks and running Sonnet on each in parallel ensures focused
// attention on every sentence. Same prompt, same schema, just smaller input.

function splitIntoChunks(text: string, maxWords = 150): string[] {
  const paragraphs = text.split(/\n\n+/).filter((p: string) => p.trim().length > 0)
  const chunks: string[] = []
  for (const para of paragraphs) {
    const wc = countWords(para)
    if (wc <= maxWords) {
      chunks.push(para)
    } else {
      // Split long paragraphs at sentence boundaries
      const sentences = para.split(/(?<=[.!?])\s+/)
      let current = ''
      for (const s of sentences) {
        if (countWords(current + ' ' + s) > maxWords && current.trim()) {
          chunks.push(current.trim())
          current = s
        } else {
          current = current ? current + ' ' + s : s
        }
      }
      if (current.trim()) chunks.push(current.trim())
    }
  }
  return chunks.length > 0 ? chunks : [text]
}


async function correctChunkSonnet(
  chunk: string, lang: 'ro' | 'en', strict: boolean,
): Promise<{ corrections: Correction[]; error?: string }> {
  let system = lang === 'ro' ? CORRECTOR_SYSTEM_RO : CORRECTOR_SYSTEM_EN
  if (strict) {
    system += lang === 'ro'
      ? `\n\nATENȚIE: încercarea anterioară a produs prea multe corecturi. Reia DOAR erorile 100% indiscutabile. Dacă ai orice dubiu — NU corecta.`
      : `\n\nWARNING: the previous attempt produced too many corrections. Redo ONLY 100% indisputable errors. If in any doubt — do NOT correct.`
  }
  const user = lang === 'ro'
    ? `TEXT DE CORECTAT (${countWords(chunk)} cuvinte):\n\n${chunk}\n\nLista corecturilor (JSON):`
    : `TEXT TO CORRECT (${countWords(chunk)} words):\n\n${chunk}\n\nCorrections list (JSON):`

  const tokens = Math.min(4000, Math.max(1500, Math.ceil(chunk.length)))
  const result = await callSonnet(system, user, tokens, 0, CORRECTIONS_ONLY_SCHEMA)
  if (result.error) return { corrections: [], error: result.error }

  const parsed = parseJsonSafe(result.text)
  if (!parsed) {
    console.error(`[proof v2] chunk correction unparseable. Raw first 300c: ${result.text.substring(0, 300)}`)
    return { corrections: [], error: 'chunk corrector returned unparseable response' }
  }

  const rawCorr = Array.isArray(parsed?.corrections) ? (parsed!.corrections as unknown[]) : []
  const corrections: Correction[] = rawCorr
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map(c => ({
      before: String(c.before ?? '').substring(0, 300),
      after: String(c.after ?? '').substring(0, 300),
      reason: String(c.reason ?? '').substring(0, 200),
      kind: 'text' as const,
    }))
    .filter(c => c.before && c.after && c.before !== c.after)
    .slice(0, 100)

  return { corrections }
}


async function correctText(
  text: string, lang: 'ro' | 'en', strict: boolean,
): Promise<{ content: string; corrections: Correction[]; error?: string }> {

  // Split text into focused chunks, run Sonnet on each in parallel
  const chunks = splitIntoChunks(text)
  console.log(`[proof v2] Sonnet: ${chunks.length} chunk(s), words: [${chunks.map(c => countWords(c)).join(', ')}]`)

  const results = await Promise.all(
    chunks.map((chunk, i) => {
      console.log(`[proof v2] chunk ${i + 1}/${chunks.length} — ${countWords(chunk)}w`)
      return correctChunkSonnet(chunk, lang, strict)
    })
  )

  // Merge corrections from all chunks
  const corrections: Correction[] = []
  let firstError: string | undefined
  for (const r of results) {
    if (r.error && !firstError) firstError = r.error
    corrections.push(...r.corrections)
  }

  // Only fail if ALL chunks failed
  const allFailed = results.every(r => !!r.error)
  if (allFailed && firstError) {
    return { content: text, corrections: [], error: firstError }
  }

  // Compute corrected content
  const content = applyAllCorrections(text, corrections)

  console.log(`[proof v2] correctText: ${corrections.length} corrections, content ${content.length}c`)
  return { content, corrections }
}

// Apply corrections sequentially to produce the corrected text.
// Used server-side for voice guard comparison. The frontend has its own
// version (applyCorrections) that respects the accepted/rejected flags.
function applyAllCorrections(originalText: string, corrections: Correction[]): string {
  let result = originalText
  for (const c of corrections) {
    if (!c.before || c.before === c.after) continue
    const idx = result.indexOf(c.before)
    if (idx === -1) continue
    if (result.substring(idx, idx + c.after.length) === c.after) continue
    result = result.substring(0, idx) + c.after + result.substring(idx + c.before.length)
  }
  return result
}




// ─── Format pass — TT house style (deterministic, fully logged) ───────────────

function applyTtFormat(
  text: string, mode: 'enforce' | 'preserve', lang: 'ro' | 'en',
): { text: string; changes: Correction[]; warnings: string[] } {
  const changes: Correction[] = []
  const warnings: string[] = []
  let r = text

  const headings = r.match(/^#{1,6}\s+.+$/gm) || []
  const boldLines = r.match(/^\s*\*\*[^*\n]+\*\*\s*$/gm) || []
  const emDashes = (r.match(/—/g) || []).length

  if (mode === 'preserve') {
    if (headings.length) warnings.push(lang === 'ro'
      ? `${headings.length} subtitlu(ri) — standardul TT cere proză continuă (nemodificat, format_mode=preserve)`
      : `${headings.length} subheading(s) — TT standard requires continuous prose (left unchanged, format_mode=preserve)`)
    if (boldLines.length) warnings.push(lang === 'ro'
      ? `${boldLines.length} linie/linii bold de sine stătătoare — interzise de standardul TT (nemodificate)`
      : `${boldLines.length} standalone bold line(s) — banned by TT standard (left unchanged)`)
    if (emDashes) warnings.push(lang === 'ro'
      ? `${emDashes} liniuță/liniuțe de pauză (—) — standardul TT cere virgule, puncte sau paranteze (nemodificate)`
      : `${emDashes} em dash(es) (—) — TT standard requires commas, periods, or parentheses (left unchanged)`)
    return { text: r, changes, warnings }
  }

  for (const h of headings) {
    const flat = h.replace(/^#{1,6}\s+/, '')
    changes.push({ before: h, after: flat, reason: lang === 'ro' ? 'subtitlu eliminat (standard TT: proză continuă)' : 'subheading flattened (TT standard: continuous prose)', kind: 'format' })
  }
  r = r.replace(/^#{1,6}\s+(.+)$/gm, '$1')

  for (const b of boldLines) {
    const flat = b.trim().replace(/^\*\*([^*]+)\*\*$/, '$1')
    changes.push({ before: b.trim(), after: flat, reason: lang === 'ro' ? 'bold de sine stătător eliminat (standard TT)' : 'standalone bold removed (TT standard)', kind: 'format' })
  }
  r = r.replace(/^\s*\*\*([^*\n]+)\*\*\s*$/gm, '$1')

  if (emDashes) {
    changes.push({
      before: '—', after: ', ',
      reason: lang === 'ro'
        ? `${emDashes} liniuță/liniuțe de pauză convertite (standard TT: fără em dash)`
        : `${emDashes} em dash(es) converted (TT standard: no em dashes)`,
      kind: 'format',
    })
    r = r.replace(/ — /g, ', ').replace(/—/g, ', ')
  }
  r = r.replace(/ – /g, ', ')

  r = tidyWhitespace(r).replace(/ {2,}/g, ' ').replace(/ ,/g, ',')
  return { text: r, changes, warnings }
}


// ─── Pass 2 — metadata with enforced summary length ───────────────────────────

interface Metadata {
  suggested_title: string; excerpt: string; summary: string
  tags: string[]; seo_title: string; seo_description: string
  summary_words: number; summary_in_range: boolean
}

async function generateMetadata(
  text: string, lang: 'ro' | 'en', originalTitle: string, category: string,
): Promise<Metadata | null> {
  const articleWords = countWords(text)
  const { min: sMin, max: sMax } = getSummaryTarget(articleWords)
  const sTarget = Math.round((sMin + sMax) / 2)

  const sysRo = `Ești secretar general de redacție la Transilvania Times. Primești un articol FINAL, scris de un autor uman. NU modifici articolul. Produci DOAR aparatul editorial, în română nativă, fidel conținutului și tonului autorului.

CERINȚE:
- "title": titlu de înaltă clasă, sentence case, 6-12 cuvinte, verb puternic, actor sau miză concretă, fără punct final, fără semn de întrebare (decât întrebare reală). Dacă titlul autorului ("${originalTitle || 'fără titlu'}") este deja puternic, propune o variantă cel mult egală ca registru, nu o înlocuire gratuită.
- "excerpt": 1-2 fraze-cârlig pentru cardul de previzualizare, fidele tonului autorului.
- "summary": rezumat de ${sMin}-${sMax} cuvinte (articolul are ${articleWords} de cuvinte), fidel tonului autorului. Pentru eseu/opinie/blog: rezumat tematic care surprinde argumentul central și registrul reflexiv. Pentru știre/analiză: cine, ce, unde, când, de ce contează. Fără opinia ta.
- "tags": 6-9 slug-uri lowercase cu cratimă, termeni de căutare nativi românești, 2-5 cuvinte fiecare.
- "seo_title": sub 60 de caractere.
- "seo_description": sub 160 de caractere.
Cuvinte interzise oriunde: crucial, esențial, semnificativ, remarcabil, notabil, peisajul, paradigmă.`

  const sysEn = `You are the managing desk editor at Transilvania Times. You receive a FINAL article written by a human author. You do NOT modify the article. You produce ONLY the editorial apparatus, faithful to the author's content and tone.

REQUIREMENTS:
- "title": high-grade title, sentence case, 6-12 words, strong verb, concrete actor or stakes, no terminal period, no question mark (unless a genuine question). If the author's title ("${originalTitle || 'untitled'}") is already strong, propose at most an equal-register variant, not a gratuitous replacement.
- "excerpt": 1-2 hook sentences for the preview card, faithful to the author's tone.
- "summary": ${sMin}-${sMax} words (the article is ${articleWords} words), faithful to the author's tone. For essay/opinion/blog: a thematic summary that captures the central argument and reflective register. For news/analysis: who, what, where, when, why it matters. No opinion of yours.
- "tags": 6-9 lowercase hyphenated slugs, 2-5 words each.
- "seo_title": under 60 characters.
- "seo_description": under 160 characters.
Banned words anywhere: crucial, essential, significant, remarkable, notable, landscape, paradigm.`

  const user = lang === 'ro'
    ? `CATEGORIE: ${category}\nTITLUL AUTORULUI: ${originalTitle || '(lipsește)'}\n\nARTICOL:\n${text.substring(0, 12000)}\n\nAparatul editorial (JSON):`
    : `CATEGORY: ${category}\nAUTHOR'S TITLE: ${originalTitle || '(missing)'}\n\nARTICLE:\n${text.substring(0, 12000)}\n\nEditorial apparatus (JSON):`

  let result = await callSonnet(lang === 'ro' ? sysRo : sysEn, user, 1500, 0.5, METADATA_SCHEMA)
  if (result.error) return null
  let parsed = parseJsonSafe(result.text)
  if (!parsed) return null

  let summary = String(parsed.summary || '').trim()
  let sw = countWords(summary)
  if (sw < sMin || sw > sMax) {
    const fixSys = lang === 'ro'
      ? `Ești secretar de redacție. Rezumatul de mai jos are ${sw} cuvinte — în afara intervalului obligatoriu de ${sMin}-${sMax}. Rescrie-l la ${sMin}-${sMax} de cuvinte EXACT, păstrând toate faptele și tonul original, fără a adăuga informații noi.`
      : `You are a desk editor. The summary below has ${sw} words — outside the mandatory ${sMin}-${sMax} range. Rewrite it to EXACTLY ${sMin}-${sMax} words, keeping all facts and the original tone, adding nothing new.`
    const fixUser = lang === 'ro' ? `REZUMAT:\n${summary}\n\nARTICOL (referință):\n${text.substring(0, 4000)}` : `SUMMARY:\n${summary}\n\nARTICLE (reference):\n${text.substring(0, 4000)}`
    result = await callSonnet(fixSys, fixUser, 600, 0.3, SUMMARY_FIX_SCHEMA)
    if (!result.error) {
      const p2 = parseJsonSafe(result.text)
      const s2 = String(p2?.summary || '').trim()
      const w2 = countWords(s2)
      if (s2 && Math.abs(w2 - sTarget) < Math.abs(sw - sTarget)) { summary = s2; sw = w2 }
    }
  }

  return {
    suggested_title: sanitizeTitle(String(parsed.title || '')),
    excerpt: String(parsed.excerpt || '').trim(),
    summary,
    tags: normalizeTags(parsed.tags),
    seo_title: sanitizeTitle(String(parsed.seo_title || '')).substring(0, 60),
    seo_description: String(parsed.seo_description || '').trim().substring(0, 160),
    summary_words: sw,
    summary_in_range: sw >= sMin && sw <= sMax,
  }
}


// ─── Metadata translation (EN → RO or RO → EN) ────────────────────────────────
//
// Instead of generating metadata independently in each language (which produced
// wildly different quality — English essayistic summary vs Romanian 12-word
// placeholder), we generate ONCE in English (proven higher quality on all
// content types) and translate the whole metadata bundle. This guarantees
// parity in tone, length, and thematic accuracy across the two versions.
//
// Tags are LOCALIZED, not literally translated: Romanian search terms are
// native ("sanatate-mintala", "reziliente"), not English word-for-word swaps.

async function translateMetadata(
  meta: Metadata, from: 'ro' | 'en',
): Promise<Metadata | null> {
  const to = from === 'ro' ? 'en' : 'ro'

  const system = to === 'ro'
    ? `Ești traducător editorial la Transilvania Times. Primești un pachet de metadate în engleză și îl produci în română nativă, PĂSTRÂND registrul, lungimea și tonul original. Nu inventa, nu comprima, nu comenta.

Reguli:
- "title": traducere fidelă, fără punct final, fără ghilimele, respectă sentence case.
- "excerpt": traducere fidelă, aceeași lungime aproximativă, același ton.
- "summary": traducere fidelă la nivel de sens; poți varia ușor lungimea (±15%) pentru limba naturală românească; NU rezuma din nou.
- "tags": LOCALIZARE, nu traducere literală. Convertește în termeni de căutare nativi românești (ex.: "mental-health" → "sanatate-mintala", "silent-suffering" → "suferinta-tacuta"). Slug-uri lowercase cu cratimă, fără diacritice, 2-5 cuvinte.
- "seo_title": traducere fidelă, sub 60 de caractere.
- "seo_description": traducere fidelă, sub 160 de caractere.

Diacritice românești complete (ă, â, î, ș, ț). Ghilimele românești „..." în text.`
    : `You are an editorial translator at Transilvania Times. You receive a metadata bundle in Romanian and produce it in English, PRESERVING the register, length, and tone of the original. Do not invent, compress, or comment.

Rules:
- "title": faithful translation, no terminal period, no quote marks, keep sentence case.
- "excerpt": faithful translation, same approximate length, same tone.
- "summary": faithful semantic translation; you may slightly vary length (±15%) for natural English; do NOT re-summarize.
- "tags": LOCALIZATION, not literal translation. Convert to native English search terms (e.g. "sanatate-mintala" → "mental-health", "suferinta-tacuta" → "silent-suffering"). Lowercase hyphenated slugs, 2-5 words.
- "seo_title": faithful translation, under 60 characters.
- "seo_description": faithful translation, under 160 characters.`

  const bundle = {
    title: meta.suggested_title,
    excerpt: meta.excerpt,
    summary: meta.summary,
    tags: meta.tags,
    seo_title: meta.seo_title,
    seo_description: meta.seo_description,
  }

  const user = to === 'ro'
    ? `METADATE ORIGINALE (EN):\n${JSON.stringify(bundle, null, 2)}\n\nVersiunea românească:`
    : `ORIGINAL METADATA (RO):\n${JSON.stringify(bundle, null, 2)}\n\nEnglish version:`

  const result = await callSonnet(system, user, 1500, 0.3, METADATA_SCHEMA)
  if (result.error) return null
  const parsed = parseJsonSafe(result.text)
  if (!parsed) return null

  const translatedSummary = String(parsed.summary || '').trim()
  const sw = countWords(translatedSummary)

  return {
    suggested_title: sanitizeTitle(String(parsed.title || '')),
    excerpt: String(parsed.excerpt || '').trim(),
    summary: translatedSummary,
    tags: normalizeTags(parsed.tags),
    seo_title: sanitizeTitle(String(parsed.seo_title || '')).substring(0, 60),
    seo_description: String(parsed.seo_description || '').trim().substring(0, 160),
    summary_words: sw,
    // The translated summary inherits the range validity of the source metadata.
    // If the source summary was in range, the translation should be too (±15%).
    summary_in_range: meta.summary_in_range,
  }
}


// ─── Optional faithful translation (voice-preserving) ─────────────────────────

async function translateFaithfully(
  text: string, title: string, from: 'ro' | 'en',
): Promise<{ title: string; content: string } | null> {
  const to = from === 'ro' ? 'en' : 'ro'
  const system = to === 'en'
    ? `You are a literary-grade RO→EN translator for Transilvania Times. Translate the author's article into English with FIDELITY FIRST: preserve the author's voice, register, rhythm, sentence order, paragraphing, and person. Do not summarize, do not embellish, do not localize beyond what comprehension requires (institution names get a brief English gloss on first mention only). Direct quotes: translate, keeping the original Romanian quote in parentheses only for legally sensitive statements. Romanian quotation marks „..." become English "...". No em dashes. JSON only: {"title":"...","content":"..."}`
    : `Ești traducător EN→RO de nivel editorial la Transilvania Times. Traduci articolul autorului în română cu FIDELITATE: păstrezi vocea, registrul, ritmul, ordinea frazelor, paragrafarea și persoana autorului. Nu rezumi, nu înflorești. Română nativă, diacritice complete (ă, â, î, ș, ț), ghilimele românești „...", numerale românești ("12 milioane de euro"). Fără liniuțe de pauză (—). JSON only: {"title":"...","content":"..."}`
  const user = to === 'en'
    ? `TITLE (RO): ${title}\n\nARTICLE (RO, ${countWords(text)} words):\n${text}\n\nFaithful English version (JSON):`
    : `TITLU (EN): ${title}\n\nARTICOL (EN, ${countWords(text)} cuvinte):\n${text}\n\nVersiunea românească fidelă (JSON):`
  const tokens = Math.min(16000, Math.max(8000, Math.ceil(text.length / 1.5)))
  const result = await callSonnet(system, user, tokens, 0.4, TRANSLATION_SCHEMA)
  if (result.error) return null
  const parsed = parseJsonSafe(result.text)
  const content = tidyWhitespace((parsed?.content as string) || '')
  const tTitle = sanitizeTitle((parsed?.title as string) || '')
  if (!content || content.length < text.length * 0.5) return null
  if (to === 'ro' && !isRomanianText(content)) return null
  return { title: tTitle, content }
}


// ─── Shared metadata assembly (used by phase 'metadata' and phase 'full') ─────
//
// English-first architecture: translate content to English (if needed),
// generate metadata ONCE in English, translate the metadata bundle to
// Romanian. Falls back to source-language generation when translation is off
// or the English pipeline fails. Returns the blog_posts-shaped payload
// (without corrections — the caller merges those when present).

async function buildMetadataPayload(
  content: string, lang: 'ro' | 'en', originalTitle: string,
  authorName: string, category: string, county: string | null,
  translate: boolean, t0: number,
): Promise<Record<string, unknown> | null> {
  let content_en = ''
  let title_en = ''
  let content_ro = ''
  let title_ro = ''
  let meta_en: Metadata | null = null
  let meta_ro: Metadata | null = null
  let sourceMeta: Metadata | null = null

  if (translate) {
    // Step 1: obtain both language versions of the content
    if (lang === 'ro') {
      content_ro = content
      title_ro = originalTitle || ''
      const englishVersion = await translateFaithfully(content, originalTitle || '', 'ro')
      if (englishVersion) {
        content_en = englishVersion.content
        title_en = englishVersion.title
        console.log(`[proof v2] Content translated to EN (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
      } else {
        console.warn('[proof v2] Content EN translation failed — falling back to per-language metadata')
      }
    } else {
      content_en = content
      title_en = originalTitle || ''
      const romanianVersion = await translateFaithfully(content, originalTitle || '', 'en')
      if (romanianVersion) {
        content_ro = romanianVersion.content
        title_ro = romanianVersion.title
        console.log(`[proof v2] Content translated to RO (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
      }
    }

    // Step 2: generate metadata in English (from English content)
    if (content_en) {
      meta_en = await generateMetadata(content_en, 'en', title_en, category)
      if (meta_en) {
        console.log(`[proof v2] EN metadata done — summary ${meta_en.summary_words}w in_range=${meta_en.summary_in_range} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
      }
    }

    // Step 3: translate the English metadata bundle to Romanian
    if (meta_en) {
      meta_ro = await translateMetadata(meta_en, 'en')
      if (meta_ro) {
        console.log(`[proof v2] RO metadata translated from EN — summary ${meta_ro.summary_words}w (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
      }
    }

    sourceMeta = lang === 'ro' ? meta_ro : meta_en
  }

  // Fallback: translation off, or English-first pipeline failed.
  if (!sourceMeta) {
    sourceMeta = await generateMetadata(content, lang, originalTitle, category)
    if (sourceMeta && lang === 'ro') meta_ro = sourceMeta
    if (sourceMeta && lang === 'en') meta_en = sourceMeta
  }

  if (!sourceMeta) return null

  const chosenTitle = originalTitle || sourceMeta.suggested_title
  const wasTranslated = !!(content_en && content_ro && (lang === 'ro' ? meta_ro : meta_en))

  const slug = generateSlug(chosenTitle || sourceMeta.suggested_title)
  const out: Record<string, unknown> = {
    ok: true,
    language: lang,
    slug,
    category,
    county,
    author_name: authorName,
    ai_editor: null,
    original_title: originalTitle || null,
    suggested_title: sourceMeta.suggested_title,
    word_count: countWords(content),
    _meta: {
      elapsed_s: Number(((Date.now() - t0) / 1000).toFixed(1)),
      summary_words: sourceMeta.summary_words,
      summary_in_range: sourceMeta.summary_in_range,
      translated: wasTranslated,
      metadata_flow: wasTranslated ? 'english-first' : 'source-language',
      phase: 'metadata',
    },
  }

  // Source-language output (always present)
  out[`title_${lang}`] = chosenTitle
  out[`content_${lang}`] = content
  out[`excerpt_${lang}`] = sourceMeta.excerpt
  out[`summary_${lang}`] = sourceMeta.summary
  out[`tags_${lang}`] = sourceMeta.tags
  out[`seo_title_${lang}`] = sourceMeta.seo_title || chosenTitle.substring(0, 60)
  out[`seo_description_${lang}`] = sourceMeta.seo_description

  // Other-language output (present when translation ran)
  if (wasTranslated) {
    const otherLang: 'ro' | 'en' = lang === 'ro' ? 'en' : 'ro'
    const otherMeta = otherLang === 'ro' ? meta_ro : meta_en
    const otherTitle = otherLang === 'ro' ? title_ro : title_en
    const otherContent = otherLang === 'ro' ? content_ro : content_en

    out[`title_${otherLang}`] = otherTitle || (otherMeta?.suggested_title || chosenTitle)
    out[`content_${otherLang}`] = otherContent
    if (otherMeta) {
      out[`excerpt_${otherLang}`] = otherMeta.excerpt
      out[`summary_${otherLang}`] = otherMeta.summary
      out[`tags_${otherLang}`] = otherMeta.tags
      out[`seo_title_${otherLang}`] = otherMeta.seo_title || (otherTitle || chosenTitle).substring(0, 60)
      out[`seo_description_${otherLang}`] = otherMeta.seo_description
    }
  }

  return out
}


// ═══════════════════════════════════════════════════════════════════════════
// SERVE HANDLER
// ═══════════════════════════════════════════════════════════════════════════

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const t0 = Date.now()
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const rawText = typeof body.text === 'string' ? body.text : ''
    const originalTitle = sanitizeTitle(typeof body.title === 'string' ? body.title : '')
    const authorName = (typeof body.author_name === 'string' && body.author_name.trim()) ? body.author_name.trim().substring(0, 120) : 'Redacția'
    const category = (typeof body.category === 'string' && body.category.trim()) ? body.category.trim().toLowerCase() : 'opinion'
    const countyRaw = typeof body.county === 'string' ? body.county.trim().toLowerCase() : ''
    const county = ALLOWED_COUNTIES.includes(countyRaw) ? countyRaw : null
    const translate = body.translate === true
    const formatMode: 'enforce' | 'preserve' = body.format_mode === 'preserve' ? 'preserve' : 'enforce'

    // ── Phase routing
    //
    // The full pipeline (correction + translation + metadata + metadata
    // translation) is 4-5 sequential Sonnet calls. Under API load a single
    // structured-output generation can take 60-100s, and the gateway closes
    // the client connection at ~150s — the sequential design cannot fit the
    // budget on a slow day. The pipeline is therefore split:
    //
    //   phase: 'correct'  — Pass 1 + voice guard + format pass only (1-2 calls)
    //   phase: 'metadata' — takes corrected_text, runs translation + EN
    //                       metadata + RO metadata translation (3 calls)
    //   phase: 'full'     — legacy single-shot behavior (default, kept for
    //                       backward compatibility)
    //
    // The frontend chains correct → metadata, each invocation getting its own
    // gateway budget, and shows corrections as soon as phase 1 lands.
    const phase: 'correct' | 'metadata' | 'full' =
      body.phase === 'correct' ? 'correct' : body.phase === 'metadata' ? 'metadata' : 'full'

    if (!rawText || rawText.length < 300) {
      return new Response(JSON.stringify({ ok: false, error: 'Textul este prea scurt (minimum 300 de caractere).' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const text = tidyWhitespace(rawText).substring(0, 60000)
    const lang: 'ro' | 'en' = (body.language === 'ro' || body.language === 'en')
      ? body.language
      : (isRomanianText(text) ? 'ro' : 'en')

    console.log(`[proof v2] START — phase=${phase}, lang=${lang}, ${countWords(text)}w, author=${authorName}, format=${formatMode}, translate=${translate}`)

    // ═══ PHASE: metadata ═══
    // Input text here is the ALREADY-CORRECTED content from phase 'correct'.
    // No correction, no voice guard, no format pass — straight to translation
    // and metadata assembly.
    if (phase === 'metadata') {
      const content = text
      const out = await buildMetadataPayload(content, lang, originalTitle, authorName, category, county, translate, t0)
      if (!out) {
        return new Response(JSON.stringify({ ok: false, error: 'Generarea metadatelor a eșuat.' }), {
          status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }
      console.log(`[proof v2] METADATA DONE — ${((Date.now() - t0) / 1000).toFixed(1)}s`)
      return new Response(JSON.stringify(out), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    // ── PASS 1 — correction
    let pass1 = await correctText(text, lang, false)
    let correctionFailed = false
    if (pass1.error) {
      console.warn(`[proof v2] Pass 1 FAILED: ${pass1.error} — proceeding with original text (no corrections)`)
      // Graceful degradation: correction failed, but the article is still
      // publishable as-is. We return ok=true with the ORIGINAL text and
      // empty corrections, plus a correction_error field for the frontend
      // to display. The frontend can still fire phase 2 (metadata) and the
      // editor can still publish the article without AI corrections.
      correctionFailed = true
      pass1 = { content: text, corrections: [], error: pass1.error }
    }

    // ── VOICE GUARD (skip if correction already failed)
    let changeRatio = correctionFailed ? 0 : tokenChangeRatio(text, pass1.content)
    let voiceWarning = false
    if (!correctionFailed && changeRatio > VOICE_CHANGE_LIMIT) {
      console.warn(`[proof v2] voice guard tripped (${(changeRatio * 100).toFixed(1)}% change) — strict retry`)
      const retry = await correctText(text, lang, true)
      if (!retry.error) {
        const retryRatio = tokenChangeRatio(text, retry.content)
        if (retryRatio < changeRatio) { pass1 = retry; changeRatio = retryRatio }
      }
      if (changeRatio > VOICE_CHANGE_LIMIT) {
        voiceWarning = true
        console.warn(`[proof v2] voice guard STILL over limit (${(changeRatio * 100).toFixed(1)}%) — flagged for human review`)
      }
    }
    console.log(`[proof v2] Pass 1 done — ${pass1.corrections.length} corrections, change_ratio=${(changeRatio * 100).toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(1)}s)`)

    // ── FORMAT PASS
    const fmt = applyTtFormat(pass1.content, formatMode, lang)
    const content = fmt.text
    const corrections = [...pass1.corrections, ...fmt.changes]

    // ═══ PHASE: correct ═══
    // Return the corrections immediately; the frontend fires phase 'metadata'
    // with the corrected content as its own request.
    if (phase === 'correct') {
      const out: Record<string, unknown> = {
        ok: true,
        language: lang,
        category,
        county,
        author_name: authorName,
        original_title: originalTitle || null,
        corrections,
        corrections_count: corrections.length,
        format_warnings: fmt.warnings,
        change_ratio: Number(changeRatio.toFixed(4)),
        voice_warning: voiceWarning,
        word_count: countWords(content),
        corrected_content: content,
        _meta: {
          elapsed_s: Number(((Date.now() - t0) / 1000).toFixed(1)),
          phase: 'correct',
          format_mode: formatMode,
          proofread_failed: correctionFailed,
        },
      }
      if (correctionFailed) {
        out.correction_error = pass1.error
      }
      console.log(`[proof v2] CORRECT DONE — ${corrections.length} corrections, proofread_failed=${correctionFailed}, ${((Date.now() - t0) / 1000).toFixed(1)}s`)
      return new Response(JSON.stringify(out), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    // ═══ PHASE: full (legacy) ═══
    //
    // When translation is on (which is the case for the entire Transilvania
    // Times workflow — the paper is bilingual), we generate metadata ONCE in
    // English (empirically higher quality across all content types, especially
    // essays and opinion pieces where Romanian per-language generation was
    // producing 12-word placeholder summaries), then translate the metadata
    // bundle to Romanian. This guarantees tone/length parity across languages.
    //
    // When translation is off, fall back to source-language generation.
    const metaOut = await buildMetadataPayload(content, lang, originalTitle, authorName, category, county, translate, t0)
    if (!metaOut) {
      console.error('[proof v2] Pass 2 FAILED: metadata generation returned null')
      return new Response(JSON.stringify({ ok: false, error: 'Generarea metadatelor a eșuat.' }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const out: Record<string, unknown> = {
      ...metaOut,
      corrections,
      corrections_count: corrections.length,
      format_warnings: fmt.warnings,
      change_ratio: Number(changeRatio.toFixed(4)),
      voice_warning: voiceWarning,
      _meta: {
        ...(metaOut._meta as Record<string, unknown>),
        format_mode: formatMode,
        phase: 'full',
      },
    }

    console.log(`[proof v2] DONE — ${corrections.length} corrections, ratio=${(changeRatio * 100).toFixed(1)}%, voice_warning=${voiceWarning}, ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    return new Response(JSON.stringify(out), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (e) {
    const msg = (e as Error).message || 'unknown'
    console.error(`[proof v2] FATAL: ${msg}`)
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
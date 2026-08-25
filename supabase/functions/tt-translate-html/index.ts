// supabase/functions/tt-translate-html/index.ts
//
// Translates a 'rich' (Word-imported) article body between Romanian and English
// while preserving the EXACT HTML structure — bold, italic, headings, lists and
// tables all stay in place; only the human-readable text is translated. This is
// what makes the English version 1:1 with the Romanian one for Birou editorial
// rich articles.
//
// Input:  { html: string, source_lang: 'ro'|'en', target_lang: 'ro'|'en' }
// Output: { ok: true, html: string } | { ok: false, error: string }
// Env:    CLAUDE_API_KEY  (shared with the rest of the pipeline)
//
// Deploy PUBLIC (no JWT verification) — the token-gated editor calls it without
// a Supabase session, exactly like tt-proof-article.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { callClaude, CLAUDE_SONNET } from '../_shared/claude.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const LANG = { ro: 'Romanian', en: 'English' } as const

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const html = String(body.html || '').trim()
    const source: 'ro' | 'en' = body.source_lang === 'en' ? 'en' : 'ro'
    const target: 'ro' | 'en' = body.target_lang === 'ro' ? 'ro' : 'en'

    if (!html) return json({ ok: false, error: 'html is required' }, 400)
    if (source === target) return json({ ok: true, html })

    const system = [
      `You are a professional news translator for a bilingual Romanian/English newspaper (Transilvania Times).`,
      `Translate the article body below from ${LANG[source]} to ${LANG[target]}.`,
      ``,
      `Return VALID HTML whose STRUCTURE is identical to the input:`,
      `- Preserve every tag, its attributes, and their order EXACTLY: <p>, <br>, <strong>, <b>, <em>, <i>, <u>, <s>, <h2>, <h3>, <h4>, <blockquote>, <ul>, <ol>, <li>, <a>, <sub>, <sup>, <hr>, <table>, <thead>, <tbody>, <tfoot>, <tr>, <th>, <td>, <caption>.`,
      `- Translate ONLY the human-readable text between the tags. Do NOT add, remove, merge, split, or reorder any element.`,
      `- Keep inline emphasis on the same words: bold stays bold, italic stays italic.`,
      `- Translate each table cell's text in place; never change the table's rows or columns.`,
      `- Keep numbers, dates, URLs, and proper names intact. Do NOT add a title, extra headings, notes, or a wrapping element.`,
      ``,
      `Output ONLY the translated HTML — no markdown code fences, no preamble, no explanation.`,
    ].join('\n')

    const { text, error } = await callClaude({
      systemInstruction: system,
      userMessage: html,
      model: CLAUDE_SONNET,
      temperature: 0.2,
      maxTokens: 8000,
    })

    if (error) return json({ ok: false, error }, 502)

    const out = (text || '')
      .trim()
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    if (!out) return json({ ok: false, error: 'empty translation' }, 502)
    return json({ ok: true, html: out })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message || 'Unknown error' }, 500)
  }
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

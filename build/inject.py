#!/usr/bin/env python3
# Builds the shipped edge-function files: copies the DEPLOYED-equal repo source
# into the pack, inlines the canonical anti-AI module (verbatim, between markers),
# and applies the minimal call-site hooks. Every edit asserts it matched exactly
# once, so a drifted source fails the build loudly instead of silently no-op-ing.
import io, os, re, sys

REPO = '/home/claude/tt-repo/supabase/functions'
OUT  = '/home/claude/out/tt-anti-ai-pack/supabase/functions'
MOD  = os.path.join(OUT, '_shared', 'tt-anti-ai.ts')

def read(p): return io.open(p, encoding='utf-8').read()
def write(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    io.open(p, 'w', encoding='utf-8').write(s)

def sub_once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        print(f"  !! {label}: expected 1 match, found {n}"); sys.exit(1)
    print(f"  ok {label}")
    return s.replace(old, new)

# ── extract the inline block from the canonical module ──────────────────────
mod = read(MOD)
# Anchor on the UNIQUE marker phrases — the module's own doc-comment contains
# example marker glyphs, so match "(copy from here)" / "(copy to here)".
m = re.search(r'INLINE ▽ \(copy from here\).*?\n(.*?)// ╚═ TT-ANTI-AI INLINE △ \(copy to here\)', mod, re.S)
if not m:
    print("could not find INLINE markers in module"); sys.exit(1)
BLOCK_BODY = m.group(1).rstrip() + '\n'
assert 'function ttScoreAiTells' in BLOCK_BODY and 'function ttDeShoutTitle' in BLOCK_BODY, \
    "inline block is incomplete"
print(f"inline block: {BLOCK_BODY.count(chr(10))} lines")

def inline_block(fnname):
    return (
        "\n// ╔══════════════════════════════════════════════════════════════════════╗\n"
        f"// ║ TT-ANTI-AI — inlined verbatim from supabase/functions/_shared/tt-anti-ai.ts ║\n"
        "// ║ Single source of truth. Do NOT hand-edit here; edit the module and re-run  ║\n"
        "// ║ build/inject.py. Kept inline so this file dashboard-pastes with no import. ║\n"
        "// ╚══════════════════════════════════════════════════════════════════════╝\n"
        + BLOCK_BODY +
        "// ── end TT-ANTI-AI inline ─────────────────────────────────────────────────\n"
    )

# shared prompt snippets ------------------------------------------------------
CASE_RULE_EN = (
    "□ SENTENCE CASE, NOT SHOUTING. Write the title in sentence case, like a Romanian\n"
    "  newspaper: capitalize ONLY the first word and proper nouns (people, places,\n"
    "  institutions). NEVER put the title, or any word in it, in ALL CAPS, and do NOT\n"
    "  Capitalize Every Word. Real acronyms stay uppercase (PSD, PNL, UE, SUA, NATO, TVA, PNRR).\n"
    "  FAILED: \"ROMANIA CUTS DEFICIT\"  /  \"Romania Cuts Deficit By 44%\"\n"
    "  PASSED: \"Romania cuts deficit by 44%\"\n\n"
)

# ════════════════════════════════════════════════════════════════════════════
# 1) tt-translate-html  — arm the currently-undefended rich-Birou translator
# ════════════════════════════════════════════════════════════════════════════
def patch_translate():
    p_in  = os.path.join(REPO, 'tt-translate-html', 'index.ts')
    p_out = os.path.join(OUT,  'tt-translate-html', 'index.ts')
    s = read(p_in)
    print("tt-translate-html")

    # a) drop the ../_shared/claude.ts import and inline callClaude + the anti-AI
    #    module, so this function is fully self-contained for dashboard paste.
    claude_inline = (
        "// ── Anthropic Claude helper (inlined from _shared/claude.ts so this function\n"
        "//    is fully self-contained for dashboard paste — no ../_shared import) ──────\n"
        "const CLAUDE_SONNET = 'claude-sonnet-4-6'\n"
        "interface ClaudeRequest { systemInstruction: string; userMessage: string; temperature?: number; maxTokens?: number; jsonMode?: boolean; model?: string }\n"
        "interface ClaudeResponse { text: string; error?: string }\n"
        "async function claudeFetchWithRetry(body: object, apiKey: string, attempt = 0): Promise<Response> {\n"
        "  const res = await fetch('https://api.anthropic.com/v1/messages', {\n"
        "    method: 'POST',\n"
        "    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },\n"
        "    body: JSON.stringify(body),\n"
        "    signal: AbortSignal.timeout(120_000),\n"
        "  })\n"
        "  if (res.status === 429 && attempt < 3) {\n"
        "    const delay = Math.pow(2, attempt) * 2000\n"
        "    console.warn(`[Claude] Rate limited. Retrying in ${delay}ms (attempt ${attempt + 1}/3)`)\n"
        "    await new Promise((r) => setTimeout(r, delay))\n"
        "    return claudeFetchWithRetry(body, apiKey, attempt + 1)\n"
        "  }\n"
        "  return res\n"
        "}\n"
        "async function callClaude({ systemInstruction, userMessage, temperature = 0.7, maxTokens = 4096, jsonMode = false, model = CLAUDE_SONNET }: ClaudeRequest): Promise<ClaudeResponse> {\n"
        "  const apiKey = Deno.env.get('CLAUDE_API_KEY')\n"
        "  if (!apiKey) return { text: '', error: 'CLAUDE_API_KEY not configured' }\n"
        "  const system = jsonMode ? `${systemInstruction}\\n\\nCRITICAL: Respond with ONLY a valid JSON object. No markdown, no backticks, no preamble.` : systemInstruction\n"
        "  try {\n"
        "    const t0 = Date.now()\n"
        "    const res = await claudeFetchWithRetry({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: userMessage }] }, apiKey)\n"
        "    const data = await res.json()\n"
        "    if (!res.ok) return { text: '', error: data.error?.message || JSON.stringify(data.error) || 'Claude API error' }\n"
        "    const text = data.content?.[0]?.text || ''\n"
        "    console.log(`[Claude] ${model} — ${Date.now() - t0}ms — ${text.length} chars`)\n"
        "    return { text }\n"
        "  } catch (e) {\n"
        "    return { text: '', error: (e as Error).message }\n"
        "  }\n"
        "}\n"
    )
    anchor = "import { callClaude, CLAUDE_SONNET } from '../_shared/claude.ts'\n"
    s = sub_once(s, anchor, claude_inline + inline_block('translate'), "inline claude + module")

    # b) add anti-AI word/dash/case guidance to the system prompt, before the
    #    final "Output ONLY ..." line
    en_words = ("delve, boasts, nestled, tapestry, \\\"a testament to\\\", \\\"stands as a\\\", "
                "underscores, showcases, \\\"it's worth noting\\\", \\\"plays a crucial role\\\", "
                "moreover / furthermore")
    ro_words = ("\\u201ejoac\\u0103 un rol crucial\\u201d, \\u201ereprezint\\u0103 o dovad\\u0103\\u201d, "
                "\\u201emerit\\u0103 men\\u021bionat c\\u0103\\u201d, \\u201eo gam\\u0103 larg\\u0103 de\\u201d, "
                "\\u201e\\u00een cele din urm\\u0103\\u201d")
    guidance = (
        "      ``,\n"
        "      `Choose natural, human news wording in ${LANG[target]} — do not make it read like a machine:`,\n"
        "      `- Use NO em dashes or en dashes (\\u2014 \\u2013). Use commas, periods or parentheses instead.`,\n"
        "      `- Any heading or title stays in sentence case: never ALL CAPS, never Title Case; keep real acronyms (PSD, UE, NATO, TVA).`,\n"
        "      `- Avoid AI-tell words and filler: ${target === 'en' ? `" + en_words + "` : `" + ro_words + "`}. Prefer plain words.`,\n"
        "      `- No summary or conclusion filler paragraph; keep it factual and direct.`,\n"
    )
    final_line = "      `Output ONLY the translated HTML — no markdown code fences, no preamble, no explanation.`,\n"
    s = sub_once(s, final_line, guidance + final_line, "prompt guidance")

    # c) deterministic safety net: humanize the returned HTML (text nodes only)
    s = sub_once(s, "    if (!out) return json({ ok: false, error: 'empty translation' }, 502)\n"
                    "    return json({ ok: true, html: out })\n",
                    "    if (!out) return json({ ok: false, error: 'empty translation' }, 502)\n"
                    "    // deterministic anti-AI safety net — strips dashes / AI lexicon / calms\n"
                    "    // ALL-CAPS headings, touching ONLY text nodes so the HTML structure stays 1:1\n"
                    "    const humanized = ttHumanizeHtml(out, target)\n"
                    "    return json({ ok: true, html: humanized })\n",
                    "humanize output")
    write(p_out, s)

# ════════════════════════════════════════════════════════════════════════════
# helpers for the two big self-contained functions
# ════════════════════════════════════════════════════════════════════════════
def patch_big(name, import_anchor, title_craft_open):
    p_in  = os.path.join(REPO, name, 'index.ts')
    p_out = os.path.join(OUT,  name, 'index.ts')
    s = read(p_in)
    print(name)

    # a) inline the module after the createClient import
    s = sub_once(s, import_anchor, import_anchor + inline_block(name), "inline module")

    # b) de-shout every title: sanitizeTitle is the single chokepoint both funcs
    #    route every title through. Wrap its return.
    title_ret = ("  return text.replace(/[#*_`]/g, '').replace(/[.,;:]+$/, '')"
                 ".replace(/\\.{2,}$/, '').trim()\n")
    title_ret_new = ("  return ttDeShoutTitle(text.replace(/[#*_`]/g, '').replace(/[.,;:]+$/, '')"
                     ".replace(/\\.{2,}$/, '').trim())\n")
    s = sub_once(s, title_ret, title_ret_new, "sanitizeTitle de-shout")

    # c) content lexicon scrub — rename each sanitizer to *Core and add a thin
    #    wrapper (hoisted), so every existing call site gains the shared layer
    #    without touching the 100+ hand-tuned rules inside.
    s = sub_once(s, "function sanitizeContentEn(text: string): string {",
                    "function sanitizeContentEn(text: string): string {\n"
                    "  // shared anti-AI layer on top of the per-function rules (single source of truth)\n"
                    "  return ttScrubLexicon(sanitizeContentEnCore(text), 'en')\n"
                    "}\n"
                    "function sanitizeContentEnCore(text: string): string {",
                    "wrap sanitizeContentEn")
    s = sub_once(s, "function sanitizeContentRo(text: string): string {",
                    "function sanitizeContentRo(text: string): string {\n"
                    "  return ttScrubLexicon(sanitizeContentRoCore(text), 'ro')\n"
                    "}\n"
                    "function sanitizeContentRoCore(text: string): string {",
                    "wrap sanitizeContentRo")

    # d) add the sentence-case rule to the English title prompt
    s = sub_once(s, title_craft_open, title_craft_open + CASE_RULE_EN, "EN title case rule")

    write(p_out, s)

# ════════════════════════════════════════════════════════════════════════════
patch_translate()

patch_big(
    'tt-process-scraped-article',
    "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'\n",
    "const TITLE_CRAFT_EN = `TITLE SELF-TEST — run this checklist BEFORE outputting any title:\n\n",
)
patch_big(
    'tt-rewrite-blog-post',
    "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'\n",
    "const TITLE_CRAFT_EN = `TITLE SELF-TEST — run this checklist BEFORE outputting any title:\n\n",
)

# ════════════════════════════════════════════════════════════════════════════
# 4) tt-ai-tell-score  — the NEW deterministic detector (admin-gated)
# ════════════════════════════════════════════════════════════════════════════
def patch_detector():
    print("tt-ai-tell-score")
    ra = read('/home/claude/out/snippets/_ra_inline.ts').rstrip() + '\n'
    header = (
        "// supabase/functions/tt-ai-tell-score/index.ts\n"
        "//\n"
        "// Deterministic \"AI-tell score\" for the pre-publish admin check — no LLM, so it\n"
        "// is instant and free. Scores an article's English and Romanian title+body for\n"
        "// the machine-writing tells (ALL-CAPS titles, em dashes, the AI lexicon, \"not\n"
        "// only … but also\", summary paragraphs …) and returns the score, a level, and\n"
        "// the NAMED tells with a sample of each, so an editor sees exactly what to fix.\n"
        "//\n"
        "// Input : { blog_post_id: string }                      // scores both languages\n"
        "//    or : { title?: string, content?: string, lang?: 'en'|'ro' }\n"
        "// Output: { ok:true, overall:{score,level}, en?:Report, ro?:Report }\n"
        "//\n"
        "// Deploy GATED (admin only) — same posture as tt-adsense-quality-check.\n\n"
        "import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'\n"
        "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'\n\n"
        "const cors = {\n"
        "  'Access-Control-Allow-Origin': '*',\n"
        "  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',\n"
        "  'Access-Control-Allow-Methods': 'POST, OPTIONS',\n"
        "}\n"
        "const json = (data: unknown, status = 200): Response =>\n"
        "  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })\n"
    )
    body = (
        "\nserve(async (req) => {\n"
        "  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })\n"
        "  if (req.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405)\n\n"
        "  const denied = await requireAdmin(req)\n"
        "  if (denied) return denied\n\n"
        "  try {\n"
        "    const input = await req.json().catch(() => ({})) as {\n"
        "      blog_post_id?: string; title?: string; content?: string; lang?: 'en' | 'ro'\n"
        "    }\n\n"
        "    // ad-hoc scoring of supplied text\n"
        "    if (!input.blog_post_id) {\n"
        "      const lang: 'en' | 'ro' = input.lang === 'ro' ? 'ro' : 'en'\n"
        "      const rep = ttScoreAiTells({ title: input.title, content: input.content, lang })\n"
        "      return json({ ok: true, overall: { score: rep.score, level: rep.level }, [lang]: rep })\n"
        "    }\n\n"
        "    // score a stored article, both languages\n"
        "    const url = Deno.env.get('SUPABASE_URL')!\n"
        "    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!\n"
        "    const sb = createClient(url, serviceKey, { auth: { persistSession: false } })\n\n"
        "    const { data: post, error } = await sb\n"
        "      .from('blog_posts')\n"
        "      .select('title_en, content_en, title_ro, content_ro')\n"
        "      .eq('id', input.blog_post_id)\n"
        "      .single()\n"
        "    if (error || !post) return json({ ok: false, error: error?.message || 'Article not found' }, 404)\n\n"
        "    const en = ttScoreAiTells({ title: post.title_en as string, content: post.content_en as string, lang: 'en' })\n"
        "    const ro = ttScoreAiTells({ title: post.title_ro as string, content: post.content_ro as string, lang: 'ro' })\n"
        "    const hasEn = Boolean((post.title_en as string) || (post.content_en as string))\n"
        "    const hasRo = Boolean((post.title_ro as string) || (post.content_ro as string))\n\n"
        "    const scores = [hasEn ? en.score : -1, hasRo ? ro.score : -1].filter((n) => n >= 0)\n"
        "    const worst = scores.length ? Math.max(...scores) : 0\n"
        "    const level = worst === 0 ? 'clean' : worst <= 15 ? 'low' : worst <= 40 ? 'medium' : 'high'\n\n"
        "    const out: Record<string, unknown> = { ok: true, overall: { score: worst, level } }\n"
        "    if (hasEn) out.en = en\n"
        "    if (hasRo) out.ro = ro\n"
        "    return json(out)\n"
        "  } catch (e) {\n"
        "    return json({ ok: false, error: (e as Error).message || 'Unknown error' }, 500)\n"
        "  }\n"
        "})\n"
    )
    full = (header
            + "\n// ── admin gate (inlined) " + "─" * 47 + "\n" + ra
            + "\n// ── anti-AI module (inlined from _shared/tt-anti-ai.ts) " + "─" * 17 + "\n"
            + BLOCK_BODY
            + "// ── end inline " + "─" * 60 + "\n" + body)
    write(os.path.join(OUT, 'tt-ai-tell-score', 'index.ts'), full)
    print("  ok wrote", full.count(chr(10)) + 1, "lines")

patch_detector()
print("\nBUILD OK")

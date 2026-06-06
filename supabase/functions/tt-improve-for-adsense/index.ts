// supabase/functions/tt-improve-for-adsense/index.ts
//
// TT Improve for AdSense - safe in-place editorial improvement
//
// Purpose:
// - reads one blog_posts row
// - reads optional source material from article_source_materials or scraped_articles
// - rewrites only editorial text fields to improve AdSense/readability/originality
// - preserves slug, status, source links, scraped_article_id, cover image, analytics relations, and all IDs
//
// Required env:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - OPENAI_API_KEY
//
// Deploy:
// supabase functions deploy tt-improve-for-adsense --verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const OPENAI_MODEL = "gpt-4o"
const CALL_TIMEOUT_MS = 90000

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

type ArticleType = "news" | "editorial" | "opinie" | "analiza" | "pamflet" | "blog" | "reportaj" | "cultura" | "tehnologie" | "unknown"

interface BlogPost {
  id: string
  slug: string | null
  title_ro: string | null
  title_en: string | null
  content_ro: string | null
  content_en: string | null
  excerpt_ro: string | null
  excerpt_en: string | null
  summary_ro: string | null
  summary_en: string | null
  category: string | null
  subcategory: string | null
  source_url: string | null
  scraped_article_id: string | null
  author_name: string | null
  ai_editor: string | null
  status: string | null
  cover_image: string | null
  cover_image_credit?: string | null
}

interface SourceMaterial {
  source_type: string
  source_url: string | null
  source_title: string | null
  source_text: string | null
}

interface ImprovedArticlePayload {
  title_ro: string | null
  title_en: string | null
  excerpt_ro: string | null
  excerpt_en: string | null
  summary_ro: string | null
  summary_en: string | null
  content_ro: string | null
  content_en: string | null
  editorial_notes: string[]
}

function getEnv(name: string): string | undefined {
  const denoObj = (globalThis as any).Deno

  if (denoObj && denoObj.env) {
    if (typeof denoObj.env.get === "function") return denoObj.env.get(name)
    if (typeof denoObj.env.toObject === "function") {
      const envObject = denoObj.env.toObject()
      return envObject ? envObject[name] : undefined
    }
    if (typeof denoObj.env === "object" && denoObj.env[name]) return denoObj.env[name]
  }

  return undefined
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: { ...CORS, "Content-Type": "application/json" }
  })
}

function plain(message: string, status = 400): Response {
  return new Response(message, {
    status: status,
    headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" }
  })
}

function cleanText(value: string | null | undefined): string {
  return String(value || "").replace(/\r\n/g, "\n").trim()
}

function countWords(value: string | null | undefined): number {
  const text = cleanText(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

function truncate(value: string | null | undefined, max = 12000): string {
  const text = cleanText(value)
  if (text.length <= max) return text
  return text.slice(0, max) + "..."
}

function parseJsonSafe(text: string): Record<string, unknown> | null {
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function optionalString(v: unknown): string | null {
  const s = String(v || "").trim()
  return s ? s : null
}

function stringArray(v: unknown, max = 20): string[] {
  if (!Array.isArray(v)) return []
  return v.map(function (x) { return String(x || "").trim() }).filter(Boolean).slice(0, max)
}

function normalizeArticleType(v: unknown): ArticleType {
  const s = String(v || "").toLowerCase().trim()
  if (s === "news") return "news"
  if (s === "editorial") return "editorial"
  if (s === "opinie" || s === "opinion") return "opinie"
  if (s === "analiza" || s === "analiză" || s === "analysis") return "analiza"
  if (s === "pamflet" || s === "pamphlet") return "pamflet"
  if (s === "blog") return "blog"
  if (s === "reportaj" || s === "reportage") return "reportaj"
  if (s === "cultura" || s === "cultură" || s === "culture") return "cultura"
  if (s === "tehnologie" || s === "technology") return "tehnologie"
  return "unknown"
}

function inferArticleType(post: BlogPost, expected?: unknown): ArticleType {
  const explicit = normalizeArticleType(expected)
  if (explicit !== "unknown") return explicit

  const category = String(post.category || "").toLowerCase()
  const subcategory = String(post.subcategory || "").toLowerCase()

  if (subcategory.includes("pamflet")) return "pamflet"
  if (subcategory.includes("reportaj")) return "reportaj"
  if (subcategory.includes("analiza") || subcategory.includes("analysis")) return "analiza"
  if (subcategory.includes("blog")) return "blog"
  if (category === "technology" || category === "tehnologie") return "tehnologie"
  if (category === "culture" || category === "cultura") return "cultura"
  if (category === "opinion" || category === "opinie") return "opinie"

  return "news"
}

function inferEditorKey(post: BlogPost, expected?: unknown): string {
  const explicit = String(expected || "").trim()
  if (explicit) return explicit
  const aiEditor = String(post.ai_editor || "").trim()
  if (aiEditor) return aiEditor

  const category = String(post.category || "").toLowerCase()
  if (category === "technology" || category === "business") return "daniel_dobos"
  if (category === "politics") return "andrei_popescu"
  if (category === "culture" || category === "travel") return "lucian_bratu"
  if (category === "health") return "sofia_marinescu"
  return "victor_simon"
}

async function callOpenAI(system: string, user: string): Promise<{ text: string; error?: string }> {
  const apiKey = getEnv("OPENAI_API_KEY")
  if (!apiKey) return { text: "", error: "OPENAI_API_KEY not set" }

  const controller = new AbortController()
  const timer = setTimeout(function () { controller.abort() }, CALL_TIMEOUT_MS)

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 9000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    })

    clearTimeout(timer)
    const raw = await res.text()

    if (!res.ok) {
      return { text: "", error: "OpenAI " + res.status + ": " + raw.substring(0, 700) }
    }

    const data = JSON.parse(raw)
    return { text: data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content || "" : "" }
  } catch (e) {
    clearTimeout(timer)
    return { text: "", error: "OpenAI: " + (e as Error).message }
  }
}

async function loadSourceMaterial(supabase: any, post: BlogPost, body: any): Promise<SourceMaterial | null> {
  const bodySourceText = cleanText(body.source_text || body.original_text)
  if (bodySourceText.length >= 100) {
    return {
      source_type: "request_body",
      source_url: optionalString(body.source_url) || post.source_url || null,
      source_title: optionalString(body.source_title) || null,
      source_text: bodySourceText
    }
  }

  if (post.scraped_article_id) {
    const { data } = await supabase
      .from("scraped_articles")
      .select("original_title, original_url, original_content, original_content_full")
      .eq("id", post.scraped_article_id)
      .maybeSingle()

    const text = cleanText(data?.original_content_full || data?.original_content)
    if (text.length >= 100) {
      return {
        source_type: "scraped_article",
        source_url: data?.original_url || post.source_url || null,
        source_title: data?.original_title || null,
        source_text: text
      }
    }
  }

  const { data: manual } = await supabase
    .from("article_source_materials")
    .select("source_type, source_url, source_title, source_text, updated_at")
    .eq("blog_post_id", post.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const manualText = cleanText(manual?.source_text)
  if (manualText.length >= 100) {
    return {
      source_type: manual?.source_type || "article_source_material",
      source_url: manual?.source_url || post.source_url || null,
      source_title: manual?.source_title || null,
      source_text: manualText
    }
  }

  return null
}

function buildSystemPrompt(): string {
  const schema = {
    title_ro: "Romanian title or null",
    title_en: "English title or null",
    excerpt_ro: "Romanian excerpt/lead or null",
    excerpt_en: "English excerpt/lead or null",
    summary_ro: "Romanian short summary or null",
    summary_en: "English short summary or null",
    content_ro: "Romanian article body or null",
    content_en: "English article body or null",
    editorial_notes: ["short notes explaining what was improved"]
  }

  return [
    "You are the Transilvania Times AdSense Improvement Editor.",
    "Return valid JSON only.",
    "Your task is to improve the final article for AdSense/editorial quality without damaging the site's data model.",
    "You must preserve the article's basic facts, language pair, category, editorial voice and article type.",
    "Do not invent facts, quotes, officials, resident reactions, dates, locations, phone numbers, policies, or statistics.",
    "Do not add a direct quotation unless the exact quote exists in the source material or in the current article.",
    "If the current article contains a quote not supported by the source, convert it to indirect attribution or remove it.",
    "When source material exists, use it to check factual integrity, but avoid close paraphrase and copied sentence structure.",
    "Improve added value by adding useful context already supported by the current article or source: who is affected, why it matters, what authority/operator is involved, and what remains unclear.",
    "For news articles, use inverted pyramid structure: most important facts first, then context, then implications.",
    "For Romanian text, use natural Romanian journalistic prose, diacritics, and Romanian quotation marks only for verified quotes.",
    "Remove generic AI phrases, vague closers, over-polished corporate wording, and filler.",
    "Keep paragraphs short and readable.",
    "Do not change slug, status, source URL, author, image, category, or database IDs. You only return improved text fields.",
    "If a language version is missing, you may create it from the available version, but keep it faithful and journalistic.",
    "Return exactly this JSON shape:",
    JSON.stringify(schema, null, 2)
  ].join("\n")
}

function buildUserPrompt(post: BlogPost, source: SourceMaterial | null, report: unknown, articleType: ArticleType, editorKey: string): string {
  return [
    "Improve this article for AdSense/editorial quality.",
    "",
    "EXPECTED ARTICLE TYPE: " + articleType,
    "EXPECTED EDITOR KEY: " + editorKey,
    "CATEGORY: " + (post.category || ""),
    "SUBCATEGORY: " + (post.subcategory || ""),
    "AUTHOR: " + (post.author_name || ""),
    "CURRENT SOURCE URL: " + (post.source_url || ""),
    "",
    "QUALITY REPORT / PROBLEMS TO FIX",
    JSON.stringify(report || {}, null, 2).slice(0, 9000),
    "",
    "SOURCE MATERIAL",
    source ? (JSON.stringify({
      source_type: source.source_type,
      source_url: source.source_url,
      source_title: source.source_title,
      source_text: truncate(source.source_text, 12000)
    }, null, 2)) : "No source text available. Improve cautiously from current article only. Do not invent new facts.",
    "",
    "CURRENT ROMANIAN ARTICLE",
    "title_ro: " + (post.title_ro || ""),
    "excerpt_ro: " + (post.excerpt_ro || ""),
    "summary_ro: " + (post.summary_ro || ""),
    "content_ro:\n" + truncate(post.content_ro, 12000),
    "",
    "CURRENT ENGLISH ARTICLE",
    "title_en: " + (post.title_en || ""),
    "excerpt_en: " + (post.excerpt_en || ""),
    "summary_en: " + (post.summary_en || ""),
    "content_en:\n" + truncate(post.content_en, 12000),
    "",
    "Hard rules:",
    "- Preserve factual accuracy over style.",
    "- Do not make unsupported allegations stronger than the source.",
    "- Attribute source-dependent claims using wording such as 'potrivit sursei citate' or 'potrivit anunțului/relatării'.",
    "- Do not include the source URL inside the body unless the current editorial style normally does that.",
    "- Keep the same article type and a credible newsroom style."
  ].join("\n")
}

function normalizeImprovedPayload(raw: Record<string, unknown>, post: BlogPost): ImprovedArticlePayload {
  return {
    title_ro: optionalString(raw.title_ro) || post.title_ro || null,
    title_en: optionalString(raw.title_en) || post.title_en || null,
    excerpt_ro: optionalString(raw.excerpt_ro) || post.excerpt_ro || null,
    excerpt_en: optionalString(raw.excerpt_en) || post.excerpt_en || null,
    summary_ro: optionalString(raw.summary_ro) || post.summary_ro || null,
    summary_en: optionalString(raw.summary_en) || post.summary_en || null,
    content_ro: optionalString(raw.content_ro) || post.content_ro || null,
    content_en: optionalString(raw.content_en) || post.content_en || null,
    editorial_notes: stringArray(raw.editorial_notes)
  }
}

serve(async function (req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return plain("Method Not Allowed", 405)

  try {
    const SUPABASE_URL = getEnv("SUPABASE_URL")
    const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY")

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json({ ok: false, error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" }, 500)
    }

    const body = await req.json().catch(function () { return {} })
    const postId = String(body.blog_post_id || body.post_id || body.id || "").trim()

    if (!postId) return json({ ok: false, error: "Missing blog_post_id, post_id, or id" }, 400)

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

    const { data, error } = await supabase
      .from("blog_posts")
      .select([
        "id", "slug", "title_ro", "title_en", "content_ro", "content_en",
        "excerpt_ro", "excerpt_en", "summary_ro", "summary_en", "category", "subcategory",
        "source_url", "scraped_article_id", "author_name", "ai_editor", "status",
        "cover_image", "cover_image_credit"
      ].join(", "))
      .eq("id", postId)
      .single()

    if (error || !data) {
      return json({ ok: false, error: "Article not found: " + (error?.message || postId) }, 404)
    }

    const post = data as BlogPost

    if (countWords(post.content_ro) < 50 && countWords(post.content_en) < 50) {
      return json({ ok: false, error: "Article content is too short to improve safely" }, 400)
    }

    const articleType = inferArticleType(post, body.expected_article_type)
    const editorKey = inferEditorKey(post, body.expected_editor_key)
    const source = await loadSourceMaterial(supabase, post, body)

    const system = buildSystemPrompt()
    const user = buildUserPrompt(post, source, body.quality_report || body.adsense_report || {}, articleType, editorKey)

    const ai = await callOpenAI(system, user)
    if (ai.error) return json({ ok: false, error: ai.error }, 500)

    const parsed = parseJsonSafe(ai.text)
    if (!parsed) {
      return json({ ok: false, error: "Could not parse AI JSON response", raw: ai.text.substring(0, 1000) }, 500)
    }

    const improved = normalizeImprovedPayload(parsed, post)

    const updatePayload = {
      title_ro: improved.title_ro,
      title_en: improved.title_en,
      excerpt_ro: improved.excerpt_ro,
      excerpt_en: improved.excerpt_en,
      summary_ro: improved.summary_ro,
      summary_en: improved.summary_en,
      content_ro: improved.content_ro,
      content_en: improved.content_en,
      ai_review_reason: "Improved for AdSense/editorial quality at " + new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const { data: updated, error: updateError } = await supabase
      .from("blog_posts")
      .update(updatePayload)
      .eq("id", post.id)
      .select("id, slug, title_ro, title_en, excerpt_ro, excerpt_en, summary_ro, summary_en, content_ro, content_en, author_name, ai_editor")
      .single()

    if (updateError) {
      return json({ ok: false, error: "Update failed: " + updateError.message }, 500)
    }

    return json({
      ok: true,
      post_id: post.id,
      slug: post.slug,
      source_used: source ? {
        source_type: source.source_type,
        source_url: source.source_url,
        source_title: source.source_title,
        source_text_chars: countWords(source.source_text)
      } : null,
      editorial_notes: improved.editorial_notes,
      updated_post: updated,
      preserved: {
        slug: true,
        status: true,
        source_url: true,
        scraped_article_id: true,
        cover_image: true,
        category: true
      }
    })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message || "Unknown error" }, 500)
  }
})

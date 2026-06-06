// supabase/functions/tt-improve-for-adsense/index.ts
//
// TT Improve for AdSense - safe in-place editorial improvement
// v5: treats scraped/source text as newsroom base material and rejects editorial no-go phrasing.
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
const CALL_TIMEOUT_MS = 120000

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

type ArticleType =
  | "news"
  | "editorial"
  | "opinie"
  | "analiza"
  | "pamflet"
  | "blog"
  | "reportaj"
  | "cultura"
  | "tehnologie"
  | "unknown"

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

    if (typeof denoObj.env === "object" && denoObj.env[name]) {
      return denoObj.env[name]
    }
  }

  return undefined
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  })
}

function plain(message: string, status = 400): Response {
  return new Response(message, {
    status,
    headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" }
  })
}

function cleanText(value: string | null | undefined): string {
  return String(value || "").replace(/\r\n/g, "\n").trim()
}

function normalized(value: string | null | undefined): string {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[„”"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function countWords(value: string | null | undefined): number {
  const text = cleanText(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!text) return 0

  return text.split(/\s+/).filter(Boolean).length
}

function countParagraphs(value: string | null | undefined): number {
  const text = cleanText(value)
  if (!text) return 0

  return text
    .split(/\n\s*\n|\n/)
    .map(function (p) {
      return p.trim()
    })
    .filter(Boolean).length
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

  return v
    .map(function (x) {
      return String(x || "").trim()
    })
    .filter(Boolean)
    .slice(0, max)
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

function sourceRiskSummary(report: unknown): string {
  const anyReport = report as any
  const sourceReview = anyReport?.source_comparison_review || {}

  const parts = [
    "status=" + String(anyReport?.status || "unknown"),
    "score=" + String(anyReport?.total_score || "unknown"),
    "similarity=" + String(sourceReview.similarity_risk || "unknown"),
    "quote_integrity=" + String(sourceReview.quote_integrity_risk || "unknown"),
    "attribution=" + String(sourceReview.attribution_risk || "unknown"),
    "added_value=" + String(sourceReview.value_added_score || "unknown"),
    "ai_artifact=" + String(anyReport?.ai_artifact_review?.risk || "unknown"),
    "type_score=" + String(anyReport?.voice_and_type_review?.type_preservation_score || "unknown")
  ]

  return parts.join("; ")
}

function shouldPreserveFullArticle(post: BlogPost): boolean {
  return countWords(post.content_ro) >= 250 || countWords(post.content_en) >= 250
}

function articleTooShort(original: BlogPost, improved: ImprovedArticlePayload): boolean {
  const originalRo = countWords(original.content_ro)
  const improvedRo = countWords(improved.content_ro)
  const originalEn = countWords(original.content_en)
  const improvedEn = countWords(improved.content_en)

  if (originalRo >= 250 && improvedRo < 300) return true
  if (originalRo >= 250 && improvedRo < Math.floor(originalRo * 0.7)) return true
  if (originalRo >= 250 && countParagraphs(improved.content_ro) < 6) return true

  if (originalEn >= 250 && improvedEn < 260) return true
  if (originalEn >= 250 && improvedEn < Math.floor(originalEn * 0.65)) return true
  if (originalEn >= 250 && countParagraphs(improved.content_en) < 6) return true

  return false
}

function containsForbiddenPublicCitation(value: string | null | undefined): boolean {
  const text = normalized(value)

  const forbidden = [
    "sursa citata",
    "sursei citate",
    "relatarea initiala",
    "materialul de baza",
    "textul de baza",
    "source material",
    "base text"
  ]

  return forbidden.some(function (term) {
    return text.includes(term)
  })
}

function containsLanguageLeak(value: string | null | undefined): boolean {
  const text = normalized(value)

  const leaks = [
    " residents",
    " mayor ",
    " source ",
    " article ",
    " according to ",
    " government "
  ]

  return leaks.some(function (term) {
    return text.includes(term)
  })
}

function containsEditorialNoGo(value: string | null | undefined): boolean {
  const text = normalized(value)

  const noGo = [
    "slabiciuni sistemice",
    "slabiciuni in modul in care",
    "ridica intrebari incomode",
    "ineficienta mai larga",
    "sistemul menit sa tina astfel de companii responsabile",
    "nu este prima data",
    "nu e la prima abatere",
    "atrage critici",
    "frecvent criticata",
    "plangeri cu privire la colectarile ratate",
    "angajamentele neindeplinite",
    "tacerea este elocventa",
    "promisiunea a ramas doar pe hartie",
    "esec al supercom",
    "esecul supercom",
    "a-si onora obligatiile contractuale",
    "contractelor publice",
    "guvernele locale nu raspund",
    "oficialii guvernamentali locali",
    "necesitatea unei supravegheri mai stricte",
    "necesitatea de responsabilitate",
    "locuitorii isi pierd increderea",
    "literal si figurat",
    "nu ar fi trebuit sa persiste",
    "anxietatea creste",
    "oamenii au putine optiuni",
    "cineva dintr-o pozitie de autoritate",
    "sanatatea publica sa aiba de suferit",
    "potentialul de imbolnavire",
    "guvernamental"
  ]

  return noGo.some(function (term) {
    return text.includes(term)
  })
}

function outputHasBadPublicWording(improved: ImprovedArticlePayload): boolean {
  return (
    containsForbiddenPublicCitation(improved.content_ro) ||
    containsForbiddenPublicCitation(improved.excerpt_ro) ||
    containsForbiddenPublicCitation(improved.summary_ro) ||
    containsLanguageLeak(improved.content_ro) ||
    containsEditorialNoGo(improved.content_ro) ||
    containsEditorialNoGo(improved.excerpt_ro) ||
    containsEditorialNoGo(improved.summary_ro)
  )
}

async function callOpenAI(system: string, user: string): Promise<{ text: string; error?: string }> {
  const apiKey = getEnv("OPENAI_API_KEY")
  if (!apiKey) return { text: "", error: "OPENAI_API_KEY not set" }

  const controller = new AbortController()
  const timer = setTimeout(function () {
    controller.abort()
  }, CALL_TIMEOUT_MS)

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
        temperature: 0.18,
        max_tokens: 12000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    })

    clearTimeout(timer)

    const raw = await res.text()

    if (!res.ok) {
      return {
        text: "",
        error: "OpenAI " + res.status + ": " + raw.substring(0, 700)
      }
    }

    const data = JSON.parse(raw)

    return {
      text:
        data && data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content || ""
          : ""
    }
  } catch (e) {
    clearTimeout(timer)
    return { text: "", error: "OpenAI: " + (e as Error).message }
  }
}

async function loadSourceMaterial(
  supabase: any,
  post: BlogPost,
  body: any
): Promise<SourceMaterial | null> {
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
    content_ro: "Romanian full article body or null",
    content_en: "English full article body or null",
    editorial_notes: ["short notes explaining what was improved"]
  }

  return [
    "You are the Transilvania Times senior desk editor for AdSense-quality local journalism.",
    "Return valid JSON only. No markdown. No extra keys.",
    "The scraped/original text is INTERNAL BASE MATERIAL for factual grounding. It is not a public source to cite in the article.",
    "Never write 'sursa citată', 'potrivit sursei citate', 'relatarea inițială', 'materialul de bază', 'textul de bază', or similar public references to the input text.",
    "Your task is to produce a clean full news article, not to summarize and not to editorialize.",
    "Preserve journalistic context, but remove opinion, speculation, and broad conclusions that are not directly supported by the base material.",
    "Write as Transilvania Times is reporting the news. Do not disclose or mention the internal base material.",
    "Never invent facts, quotes, officials, resident reactions, dates, locations, phone numbers, policies, sanctions, medical claims, contract clauses, or statistics.",
    "Never add a direct quotation unless the exact quote is present in the internal base material or the current article and is clearly attributable to a person/group in the article.",
    "If quote integrity risk is medium or high, remove direct quotes that are not exactly supported. Convert them to cautious indirect wording or remove them.",
    "If similarity risk is medium or high, do not paraphrase sentence-by-sentence. Re-architect the article with a new lead, new paragraph order, new sentence structure, no copied rhythm, no copied hooks, and no copied closing lines.",
    "Use actor-based attribution only: 'locuitorii semnalează', 'potrivit programului de colectare', 'operatorul Supercom este vizat de sesizare', 'autoritățile locale pot clarifica'.",
    "If a claim cannot be tied to a real actor or concrete fact in the story, remove it or soften it.",
    "For news articles, enforce strict inverted pyramid: paragraph 1 answers what happened, where, who is involved/affected, when/duration if known, and why it matters. Later paragraphs add concrete context and what remains unclear.",
    "CRITICAL LENGTH RULE: If the current Romanian article has at least 250 words, return a full Romanian article of 350 to 550 words, with at least 6 paragraphs. Do not compress it into a brief.",
    "CRITICAL LENGTH RULE: If the current English article has at least 250 words, return a full English article of 300 to 520 words, with at least 6 paragraphs. Do not compress it into a brief.",
    "Use restrained local-news language. Avoid outrage, exaggeration, advocacy, generic endings, slogans, rhetorical questions, and AI-style filler.",
    "STRICT NO-GO PHRASES OR IDEAS: systemic weaknesses, broader inefficiency, uncomfortable questions, not the first violation, frequently criticized, government officials, public contracts, local governments do not respond, silence is eloquent, stricter supervision has never been clearer, accountability demands, residents losing trust, literally and figuratively, no options, someone in authority, public health will suffer.",
    "Do not write broad unsupported claims about Supercom's history, repeated criticism, systemic negligence, public contracts, contractual obligations, local government failure, or loss of institutional trust unless the base material explicitly proves them and the claim is essential. In normal news output, remove them.",
    "The correct safe angle is narrow: vegetal waste reportedly remained uncollected on Petru Maior Street; residents complain about smell and discomfort; collection timing is mentioned; operator Supercom is involved; what remains unclear is why collection did not happen and what response follows.",
    "Romanian text must use natural Romanian journalistic prose with diacritics and no English word leaks.",
    "Do not include the source URL inside the article body.",
    "Quality target after rewriting: full article, clean 5W lead, neutral tone, quote risk low, similarity lower, added value through useful local context, no editorial no-go phrases.",
    "Return exactly this JSON shape:",
    JSON.stringify(schema, null, 2)
  ].join("\n")
}

function buildUserPrompt(
  post: BlogPost,
  source: SourceMaterial | null,
  report: unknown,
  articleType: ArticleType,
  editorKey: string,
  repairMode = false
): string {
  const preserveFull = shouldPreserveFullArticle(post)

  return [
    repairMode
      ? "REPAIR THE PREVIOUS OUTPUT: it was too short, mentioned internal source material, leaked English, or contained editorial no-go claims."
      : "Rewrite this article as a stronger AdSense-ready Transilvania Times newsroom article.",
    "This must be a complete publishable news article, not a summary, not a brief, and not an opinion column.",
    "IMPORTANT: The source/original text below is internal base material. Do not cite it publicly. Do not write 'sursa citată' or similar wording.",
    "IMPORTANT: Remove or neutralize the article's editorial no-go claims, especially: systemic weaknesses, broader inefficiency, uncomfortable questions, Supercom history/repeated criticism, government/local authority failure, public contracts, loss of trust, calls for stricter oversight.",
    "",
    "EXPECTED ARTICLE TYPE: " + articleType,
    "EXPECTED EDITOR KEY: " + editorKey,
    "CATEGORY: " + (post.category || ""),
    "SUBCATEGORY: " + (post.subcategory || ""),
    "AUTHOR: " + (post.author_name || ""),
    "CURRENT SOURCE URL: " + (post.source_url || ""),
    "RISK SUMMARY: " + sourceRiskSummary(report),
    "FULL ARTICLE MUST BE PRESERVED: " + (preserveFull ? "YES - keep a full article with journalistic context" : "Use judgment based on source length"),
    "",
    "PRIOR QUALITY REPORT / PROBLEMS TO FIX",
    JSON.stringify(report || {}, null, 2).slice(0, 10000),
    "",
    "INTERNAL BASE MATERIAL - factual boundary only. Use it to verify facts, not to copy prose and not to cite publicly.",
    source
      ? JSON.stringify(
          {
            source_type: source.source_type,
            source_url: source.source_url,
            source_title: source.source_title,
            source_text: truncate(source.source_text, 14000)
          },
          null,
          2
        )
      : "No base text available. Improve cautiously from current article only. Do not invent new facts.",
    "",
    "CURRENT ROMANIAN ARTICLE",
    "title_ro: " + (post.title_ro || ""),
    "excerpt_ro: " + (post.excerpt_ro || ""),
    "summary_ro: " + (post.summary_ro || ""),
    "content_ro:\n" + truncate(post.content_ro, 14000),
    "",
    "CURRENT ENGLISH ARTICLE",
    "title_en: " + (post.title_en || ""),
    "excerpt_en: " + (post.excerpt_en || ""),
    "summary_en: " + (post.summary_en || ""),
    "content_en:\n" + truncate(post.content_en, 14000),
    "",
    "Mandatory rewrite checklist:",
    "- Return a complete full article, not one paragraph.",
    "- Romanian content should normally be 350-550 words and at least 6 paragraphs when the current article is a full article.",
    "- Preserve local news context: street, residents, waste type, collection timing, operator, discomfort, uncertainty, and need for clarification.",
    "- Write a new neutral 5W lead.",
    "- Do not mention the internal base material, source article, or source URL in public article text.",
    "- Use actor-based attribution: 'locuitorii semnalează', 'programul de colectare menționează', 'operatorul este vizat de sesizare', 'autoritățile locale pot clarifica'.",
    "- Remove unsupported direct quotes and avoid quote-like invented wording.",
    "- Remove generic AI/editorial filler closings.",
    "- Remove the following no-go angle entirely: systemic failure, broad supervision failure, public contracts, repeated corporate misconduct, rhetorical accountability questions.",
    "- Keep allegations cautious and tied to actors: 'locuitorii reclamă', 'situația semnalată', not definitive claims beyond the base material."
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

async function generateImprovement(
  post: BlogPost,
  source: SourceMaterial | null,
  report: unknown,
  articleType: ArticleType,
  editorKey: string,
  repairMode = false
): Promise<{ improved?: ImprovedArticlePayload; raw?: string; error?: string }> {
  const system = buildSystemPrompt()
  const user = buildUserPrompt(post, source, report, articleType, editorKey, repairMode)

  const ai = await callOpenAI(system, user)
  if (ai.error) return { error: ai.error }

  const parsed = parseJsonSafe(ai.text)
  if (!parsed) {
    return {
      error: "Could not parse AI JSON response",
      raw: ai.text.substring(0, 1000)
    }
  }

  return {
    improved: normalizeImprovedPayload(parsed, post),
    raw: ai.text
  }
}

serve(async function (req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return plain("Method Not Allowed", 405)

  try {
    const SUPABASE_URL = getEnv("SUPABASE_URL")
    const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY")

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json(
        {
          ok: false,
          error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing"
        },
        500
      )
    }

    const body = await req.json().catch(function () {
      return {}
    })

    const postId = String(body.blog_post_id || body.post_id || body.id || "").trim()

    if (!postId) {
      return json({ ok: false, error: "Missing blog_post_id, post_id, or id" }, 400)
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

    const { data, error } = await supabase
      .from("blog_posts")
      .select(
        [
          "id",
          "slug",
          "title_ro",
          "title_en",
          "content_ro",
          "content_en",
          "excerpt_ro",
          "excerpt_en",
          "summary_ro",
          "summary_en",
          "category",
          "subcategory",
          "source_url",
          "scraped_article_id",
          "author_name",
          "ai_editor",
          "status",
          "cover_image",
          "cover_image_credit"
        ].join(", ")
      )
      .eq("id", postId)
      .single()

    if (error || !data) {
      return json(
        {
          ok: false,
          error: "Article not found: " + (error?.message || postId)
        },
        404
      )
    }

    const post = data as BlogPost

    if (countWords(post.content_ro) < 50 && countWords(post.content_en) < 50) {
      return json({ ok: false, error: "Article content is too short to improve safely" }, 400)
    }

    const articleType = inferArticleType(post, body.expected_article_type)
    const editorKey = inferEditorKey(post, body.expected_editor_key)
    const source = await loadSourceMaterial(supabase, post, body)
    const report = body.quality_report || body.adsense_report || {}

    let generated = await generateImprovement(post, source, report, articleType, editorKey, false)

    if (generated.error || !generated.improved) {
      return json(
        {
          ok: false,
          error: generated.error || "Improvement failed",
          raw: generated.raw
        },
        500
      )
    }

    let improved = generated.improved
    let repairedBecauseTooShort = false
    let repairedBecauseBadPublicWording = false

    if (articleTooShort(post, improved) || outputHasBadPublicWording(improved)) {
      repairedBecauseTooShort = articleTooShort(post, improved)
      repairedBecauseBadPublicWording = outputHasBadPublicWording(improved)

      generated = await generateImprovement(post, source, report, articleType, editorKey, true)

      if (generated.error || !generated.improved) {
        return json(
          {
            ok: false,
            error:
              "Improvement output failed validation and repair failed: " +
              (generated.error || "unknown"),
            original_word_count_ro: countWords(post.content_ro),
            attempted_word_count_ro: countWords(improved.content_ro),
            attempted_paragraph_count_ro: countParagraphs(improved.content_ro)
          },
          500
        )
      }

      improved = generated.improved
    }

    if (articleTooShort(post, improved) || outputHasBadPublicWording(improved)) {
      return json(
        {
          ok: false,
          error:
            "Improvement output was rejected because it lost journalistic context, became too short, cited internal base material, leaked English, or kept editorial no-go claims. Article was not updated.",
          original_word_count_ro: countWords(post.content_ro),
          improved_word_count_ro: countWords(improved.content_ro),
          improved_paragraph_count_ro: countParagraphs(improved.content_ro),
          forbidden_public_citation_detected: containsForbiddenPublicCitation(improved.content_ro),
          language_leak_detected: containsLanguageLeak(improved.content_ro),
          editorial_no_go_detected: containsEditorialNoGo(improved.content_ro),
          advice:
            "Try again after running Verifică AdSense, or improve manually. The function refused to overwrite the article with unsafe wording."
        },
        422
      )
    }

    const updatePayload = {
      title_ro: improved.title_ro,
      title_en: improved.title_en,
      excerpt_ro: improved.excerpt_ro,
      excerpt_en: improved.excerpt_en,
      summary_ro: improved.summary_ro,
      summary_en: improved.summary_en,
      content_ro: improved.content_ro,
      content_en: improved.content_en,
      ai_review_reason:
        "Improved for AdSense/editorial quality v5 neutral newsroom article at " +
        new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const { data: updated, error: updateError } = await supabase
      .from("blog_posts")
      .update(updatePayload)
      .eq("id", post.id)
      .select(
        "id, slug, title_ro, title_en, excerpt_ro, excerpt_en, summary_ro, summary_en, content_ro, content_en, author_name, ai_editor"
      )
      .single()

    if (updateError) {
      return json({ ok: false, error: "Update failed: " + updateError.message }, 500)
    }

    return json({
      ok: true,
      post_id: post.id,
      slug: post.slug,
      improvement_version: "v5_neutral_news_no_editorial_nogo",
      repaired_because_too_short: repairedBecauseTooShort,
      repaired_because_bad_public_wording: repairedBecauseBadPublicWording,
      original_word_count_ro: countWords(post.content_ro),
      improved_word_count_ro: countWords(improved.content_ro),
      improved_paragraph_count_ro: countParagraphs(improved.content_ro),
      source_used: source
        ? {
            source_type: source.source_type,
            source_url: source.source_url,
            source_title: source.source_title,
            source_text_chars: countWords(source.source_text)
          }
        : null,
      editorial_notes: improved.editorial_notes,
      updated_post: updated,
      preserved: {
        slug: true,
        status: true,
        source_url: true,
        scraped_article_id: true,
        cover_image: true,
        category: true,
        journalistic_context: true,
        base_material_not_publicly_cited: true,
        editorial_no_go_removed: true
      }
    })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message || "Unknown error" }, 500)
  }
})

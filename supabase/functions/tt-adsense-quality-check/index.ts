// supabase/functions/tt-adsense-quality-check/index.ts
//
// TT ADSENSE QUALITY CHECK - v2.3 read-only
//
// Evaluates an existing blog_posts row for:
// 1. AdSense/editorial readiness
// 2. AI artifact and typography risk
// 3. editor voice and article type preservation
// 4. source/original comparison for scraped, source-material, or source-based articles
//
// READ-ONLY:
// - does not update blog_posts
// - does not rewrite article text
// - does not publish
// - does not change status
//
// Accepts:
// - blog_post_id OR post_id OR id
// - optional expected_article_type
// - optional expected_editor_key
// - optional source_text, source_title, source_url for Editor AI/source-based articles
//
// Required env:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - OPENAI_API_KEY
//
// Deploy:
// supabase functions deploy tt-adsense-quality-check --verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const OPENAI_MODEL = "gpt-4o"
const CALL_TIMEOUT_MS = 60000

const CORS = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS"
}

function getEnv(name: string): string | undefined {
  const denoObj = (globalThis as any).Deno

  if (denoObj && denoObj.env) {
    if (typeof denoObj.env.get === "function") {
      return denoObj.env.get(name)
    }

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

type Risk = "low" | "medium" | "high"
type Status = "PASS" | "NEEDS_EDIT" | "HIGH_RISK"
type AdvertiserFriendliness = "weak" | "acceptable" | "strong"

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
county: string | null
tags_ro: string[] | null
tags_en: string[] | null
source_url: string | null
sources: string[] | null
scraped_article_id: string | null
author_name: string | null
ai_editor: string | null
status: string | null
published_at: string | null
updated_at: string | null
word_count: number | null
cover_image: string | null
cover_image_credit: string | null
}

interface ArtifactLanguageScan {
word_count: number
paragraph_count: number
sentence_count: number
em_dash_count: number
en_dash_count: number
straight_double_quote_count: number
romanian_quote_count: number
apostrophe_count: number
suspicious_transition_count: number
ai_cliche_count: number
generic_closer_count: number
average_sentence_words: number
sentence_length_variance: number
uniform_paragraph_risk: Risk
notes: string[]
}

interface HeuristicArtifactScan {
ro: ArtifactLanguageScan
en: ArtifactLanguageScan
}

interface SourceMaterial {
available: boolean
source_type: "scraped_article" | "article_source_material" | "editor_ai_source" | "url_only" | "none"
source_url: string | null
source_title: string | null
source_text: string | null
}

interface SourceComparisonReview {
available: boolean
source_type: "scraped_article" | "article_source_material" | "editor_ai_source" | "url_only" | "none"
source_url: string | null
similarity_risk: Risk
quote_integrity_risk: Risk
attribution_risk: Risk
value_added_score: number
copied_or_near_copied_fragments: string[]
altered_or_unverified_quotes: string[]
missing_source_facts: string[]
added_value_detected: string[]
recommendations: string[]
}

interface QualityReport {
ok: boolean
post_id: string
slug: string | null
total_score: number
status: Status
risk_level: Risk
scores: {
reader_value: number
originality: number
eeat: number
policy_safety: number
engagement: number
commercial_potential: number
}
verdict_ro: string
verdict_en: string
must_fix_before_publish: string[]
recommendations: string[]
policy_risks: string[]
strengths: string[]
suggested_title_ro: string | null
suggested_title_en: string | null
suggested_excerpt_ro: string | null
suggested_excerpt_en: string | null
suggested_summary_ro: string | null
suggested_summary_en: string | null
suggested_editorial_notes: string[]
adsense_notes: {
low_value_content_risk: Risk
thin_content_risk: Risk
duplicate_or_rewrite_risk: Risk
ai_footprint_risk: Risk
unsafe_policy_risk: Risk
advertiser_friendliness: AdvertiserFriendliness
}
ai_artifact_review: {
score: number
risk: Risk
issues: string[]
typography_issues: string[]
rhythm_issues: string[]
cliche_issues: string[]
quote_and_punctuation_issues: string[]
recommendations: string[]
}
voice_and_type_review: {
expected_editor_key: string | null
expected_editor_voice: string | null
detected_editor_voice: string | null
expected_article_type: ArticleType
detected_article_type: ArticleType
voice_preservation_score: number
type_preservation_score: number
risk: Risk
issues: string[]
recommendations: string[]
}
source_comparison_review: SourceComparisonReview
heuristic_artifact_scan: HeuristicArtifactScan
checked_at: string
model: string
}

const EDITOR_VOICE_SUMMARY: Record<string, string> = {
andrei_popescu: "Andrei Popescu: politics/accountability voice; hard-hitting, evidence-driven, precise, names responsible actors, quantifies public cost, avoids softening bad news.",
lucian_bratu: "Lucian Bratu: cultural/localist voice; warm, rooted in Transylvania, community-first, sensory local detail, ordinary locals treated seriously.",
elena_vasilescu: "Elena Vasilescu: science/ideas voice; lyrical but rigorous, curious, study-aware, careful with uncertainty and methodology.",
sofia_marinescu: "Sofia Marinescu: data/health voice; clinical, precise, skeptical, contextualizes every number, states what data does not show.",
daniel_dobos: "Daniel Dobos: technology/business voice; fast, precise, slightly cynical, future-facing, names systems and tradeoffs, explains jargon for non-technical readers.",
mihai_ionescu: "Mihai Ionescu: systems/infrastructure/cybersecurity voice; precise, technical, systemic, identifies architecture, vendors, protocols and failure modes.",
victor_simon: "Victor Simon: general news wire voice; economical, active voice, strict inverted pyramid, no flourishes, no editorializing."
}

const ARTICLE_TYPE_EXPECTATIONS: Record<ArticleType, string> = {
news: "Hard news. Third person only. Inverted pyramid. 5W lede. Short paragraphs. Attribution for claims. No opinion. No subheadings. No first person.",
editorial: "Institutional editorial or signed editorial argument. Clear position early. Evidence-based. May use judgment, but must not become sentimental or vague.",
opinie: "Signed opinion column. Personal voice is allowed, but argument must be public, evidence-based and disciplined. Not a rant.",
analiza: "Analysis. Structured, methodical, explains why something matters. May be slower than news but must not become academic filler. Acknowledges limits.",
pamflet: "Satirical pamphlet. Irony allowed. Must avoid unverifiable personal attacks, protected-class attacks, vulgarity, family attacks or unsupported accusations.",
blog: "Personal essay/blog. First person allowed when experience or viewpoint is the subject. Must still offer reader value, concrete detail and insight.",
reportaj: "Reportage. Narrative opening and scene allowed. Must not invent witnesses, sensory details, quotes or local color. Concrete reporting required.",
cultura: "Culture/criticism. May use longer sentences and critical framing. Must avoid empty reverence, patriotic cliche and generic praise.",
tehnologie: "Technology journalism. Precise systems, vendors, protocols, tradeoffs. Jargon defined first, then used. Sceptical of hype.",
unknown: "Unknown type. Evaluate likely type from text and preserve the strongest credible editorial register."
}

const RO_AI_CLICHES = [
"în concluzie",
"pe scurt",
"în cele din urmă",
"în lumea de astăzi",
"în era digitală",
"în contextul actual",
"stă ca un testament",
"este un testament",
"o mărturie a",
"rezidă în",
"se traduce în",
"imersiune",
"imersiv",
"dansul dintre",
"se aventurează",
"fără egal",
"fără pereche",
"a naviga prin",
"navighează prin",
"la sfârșitul zilei",
"schimbător de joc",
"țese o poveste",
"peisajul politic",
"ecosistem",
"sinergie",
"robust",
"crucial",
"esențial",
"vital",
"semnificativ",
"remarcabil",
"notabil",
"de o importanță majoră"
]

const EN_AI_CLICHES = [
"in conclusion",
"to sum up",
"looking ahead",
"as we move forward",
"in todays world",
"in the ever-evolving",
"landscape",
"game-changer",
"revolutionize",
"cutting-edge",
"leverage",
"navigate",
"paradigm",
"holistic",
"robust",
"comprehensive",
"essential",
"crucial",
"vital",
"pivotal",
"foster",
"bolster",
"harness",
"streamline",
"synergy",
"ecosystem",
"spearhead",
"underpin",
"unlock",
"empower",
"testament to",
"shed light on",
"treasure trove",
"stark reminder"
]

const RO_GENERIC_CLOSERS = [
"ridică întrebări",
"comunitatea așteaptă răspunsuri",
"rămâne de văzut",
"doar timpul va spune",
"acest eveniment subliniază",
"acest incident subliniază",
"aceste cazuri evidențiază",
"următorul pas implică",
"concluziile ar putea influența"
]

const EN_GENERIC_CLOSERS = [
"raises questions",
"the community awaits answers",
"remains to be seen",
"only time will tell",
"this incident underscores",
"such cases highlight",
"the next phase will involve",
"the conclusions could influence"
]

const RO_SUSPICIOUS_TRANSITIONS = [
"în plus",
"de asemenea",
"mai mult",
"cu toate acestea",
"totuși",
"prin urmare",
"pe de altă parte",
"în același timp",
"este important de menționat"
]

const EN_SUSPICIOUS_TRANSITIONS = [
"furthermore",
"moreover",
"additionally",
"however",
"nevertheless",
"consequently",
"on the other hand",
"at the same time",
"it is important to note",
"notably",
"importantly"
]

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

function normalizeText(text: string | null | undefined): string {
return String(text || "").replace(/\r\n/g, "\n").trim()
}

function stripHtml(text: string): string {
return text.replace(/<[^>]+>/g, " ")
}

function countWords(text: string | null | undefined): number {
const clean = stripHtml(normalizeText(text))
if (!clean) return 0
return clean.split(/\s+/).filter(Boolean).length
}

function truncate(text: string | null | undefined, max = 9000): string {
const clean = normalizeText(text).replace(/\s+/g, " ")
if (clean.length > max) return clean.slice(0, max) + "..."
return clean
}

function countOccurrences(text: string, needles: string[]): number {
const lower = text.toLowerCase()
let count = 0

for (const n of needles) {
const needle = n.toLowerCase()
let i = lower.indexOf(needle)
while (i !== -1) {
count++
i = lower.indexOf(needle, i + needle.length)
}
}

return count
}

function splitParagraphs(text: string): string[] {
const clean = normalizeText(text)
if (!clean) return []

return clean
.split(/\n\s*\n+/)
.map(function (p) {
return stripHtml(p).replace(/\s+/g, " ").trim()
})
.filter(Boolean)
}

function splitSentences(text: string): string[] {
const clean = stripHtml(normalizeText(text)).replace(/\s+/g, " ")
if (!clean) return []

return clean
.split(/(?<=[.!?])\s+/)
.map(function (s) {
return s.trim()
})
.filter(Boolean)
}

function variance(nums: number[]): number {
if (!nums.length) return 0

const avg = nums.reduce(function (a, b) {
return a + b
}, 0) / nums.length

return nums.reduce(function (a, b) {
return a + Math.pow(b - avg, 2)
}, 0) / nums.length
}

function riskFromCounts(mediumCondition: boolean, highCondition: boolean): Risk {
if (highCondition) return "high"
if (mediumCondition) return "medium"
return "low"
}

function scanLanguageArtifacts(textRaw: string | null | undefined, lang: "ro" | "en"): ArtifactLanguageScan {
const text = normalizeText(textRaw)
const plainText = stripHtml(text)
const paragraphs = splitParagraphs(text)
const sentences = splitSentences(text)
const sentenceLengths = sentences.map(function (s) {
return s.split(/\s+/).filter(Boolean).length
})

const wordCount = countWords(text)

const avgSentence =
sentenceLengths.length > 0
? sentenceLengths.reduce(function (a, b) { return a + b }, 0) / sentenceLengths.length
: 0

const sentenceVariance = variance(sentenceLengths)

const paragraphLengths = paragraphs.map(function (p) {
return p.split(/\s+/).filter(Boolean).length
})

const paragraphVariance = variance(paragraphLengths)

const avgParagraph =
paragraphLengths.length > 0
? paragraphLengths.reduce(function (a, b) { return a + b }, 0) / paragraphLengths.length
: 0

const emDashCount = (plainText.match(/—/g) || []).length
const enDashCount = (plainText.match(/–/g) || []).length
const straightDoubleQuoteCount = (plainText.match(/"/g) || []).length
const romanianQuoteCount = (plainText.match(/[„”]/g) || []).length
const apostropheCount = (plainText.match(/[']/g) || []).length

const suspiciousTransitionCount =
lang === "ro"
? countOccurrences(plainText, RO_SUSPICIOUS_TRANSITIONS)
: countOccurrences(plainText, EN_SUSPICIOUS_TRANSITIONS)

const aiClicheCount =
lang === "ro"
? countOccurrences(plainText, RO_AI_CLICHES)
: countOccurrences(plainText, EN_AI_CLICHES)

const genericCloserCount =
lang === "ro"
? countOccurrences(plainText, RO_GENERIC_CLOSERS)
: countOccurrences(plainText, EN_GENERIC_CLOSERS)

const uniformParagraphRisk = riskFromCounts(
paragraphs.length >= 5 && paragraphVariance < Math.max(20, avgParagraph * 1.5),
paragraphs.length >= 8 && paragraphVariance < Math.max(12, avgParagraph)
)

const notes: string[] = []

if (lang === "ro" && straightDoubleQuoteCount >= 2 && romanianQuoteCount === 0) {
notes.push("Textul românesc folosește ghilimele drepte în loc de ghilimele românești.")
}

if (emDashCount >= 3) {
notes.push("Textul folosește multe em dash-uri, posibil tic stilistic sintetic.")
}

if (lang === "ro" && apostropheCount >= 2) {
notes.push("Textul românesc conține apostrofuri care pot semnala tipografie englezită sau conversie neîngrijită.")
}

if (aiClicheCount > 0) {
notes.push("Au fost detectate clișee sau formulări asociate cu text generic AI.")
}

if (suspiciousTransitionCount >= 3) {
notes.push("Textul folosește tranziții explicite repetitive.")
}

if (genericCloserCount > 0) {
notes.push("Au fost detectate încheieri generice de tip AI/editorial filler.")
}

if (sentenceVariance < 18 && sentences.length >= 10) {
notes.push("Lungimea propozițiilor pare prea uniformă.")
}

if (uniformParagraphRisk !== "low") {
notes.push("Paragrafele par prea uniforme ca lungime.")
}

return {
word_count: wordCount,
paragraph_count: paragraphs.length,
sentence_count: sentences.length,
em_dash_count: emDashCount,
en_dash_count: enDashCount,
straight_double_quote_count: straightDoubleQuoteCount,
romanian_quote_count: romanianQuoteCount,
apostrophe_count: apostropheCount,
suspicious_transition_count: suspiciousTransitionCount,
ai_cliche_count: aiClicheCount,
generic_closer_count: genericCloserCount,
average_sentence_words: Math.round(avgSentence * 10) / 10,
sentence_length_variance: Math.round(sentenceVariance * 10) / 10,
uniform_paragraph_risk: uniformParagraphRisk,
notes: notes
}
}

function heuristicScan(post: BlogPost): HeuristicArtifactScan {
return {
ro: scanLanguageArtifacts(
[
post.title_ro,
post.excerpt_ro,
post.summary_ro,
post.content_ro
].filter(Boolean).join("\n\n"),
"ro"
),
en: scanLanguageArtifacts(
[
post.title_en,
post.excerpt_en,
post.summary_en,
post.content_en
].filter(Boolean).join("\n\n"),
"en"
)
}
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

function clamp(n: unknown, min: number, max: number): number {
const x = Number(n)
if (!Number.isFinite(x)) return min
return Math.max(min, Math.min(max, Math.round(x)))
}

function normalizeRisk(v: unknown): Risk {
const s = String(v || "").toLowerCase()
if (s === "high") return "high"
if (s === "medium") return "medium"
return "low"
}

function normalizeAdvertiser(v: unknown): AdvertiserFriendliness {
const s = String(v || "").toLowerCase()
if (s === "strong") return "strong"
if (s === "weak") return "weak"
return "acceptable"
}

function stringArray(v: unknown, max = 16): string[] {
if (!Array.isArray(v)) return []

return v
.map(function (x) {
return String(x || "").trim()
})
.filter(Boolean)
.slice(0, max)
}

function optionalString(v: unknown): string | null {
const s = String(v || "").trim()
return s ? s : null
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
const tags = [
...(post.tags_ro || []),
...(post.tags_en || [])
].join(" ").toLowerCase()

const text = [
post.title_ro,
post.title_en,
post.excerpt_ro,
post.excerpt_en,
post.summary_ro,
post.summary_en
].filter(Boolean).join(" ").toLowerCase()

if (category === "technology" || category === "tehnologie") return "tehnologie"
if (category === "culture" || category === "cultura") return "cultura"
if (category === "opinion" || category === "opinie") return "opinie"
if (subcategory.includes("reportaj") || tags.includes("reportaj")) return "reportaj"
if (subcategory.includes("analiza") || subcategory.includes("analysis") || tags.includes("analiza")) return "analiza"
if (subcategory.includes("pamflet") || tags.includes("pamflet")) return "pamflet"
if (subcategory.includes("blog") || tags.includes("blog")) return "blog"
if (text.includes("opinie") || text.includes("editorial")) return "opinie"

return "news"
}

function inferEditorKey(post: BlogPost, expected?: unknown): string | null {
const explicit = String(expected || "").trim()
if (explicit && EDITOR_VOICE_SUMMARY[explicit]) return explicit

const aiEditor = String(post.ai_editor || "").trim()
if (aiEditor && EDITOR_VOICE_SUMMARY[aiEditor]) return aiEditor

const author = String(post.author_name || "").toLowerCase().trim()

if (author.includes("andrei popescu")) return "andrei_popescu"
if (author.includes("lucian bratu")) return "lucian_bratu"
if (author.includes("elena vasilescu")) return "elena_vasilescu"
if (author.includes("sofia marinescu")) return "sofia_marinescu"
if (author.includes("daniel dobos")) return "daniel_dobos"
if (author.includes("mihai ionescu")) return "mihai_ionescu"
if (author.includes("victor simon")) return "victor_simon"

return null
}

function riskRank(r: Risk): number {
if (r === "high") return 3
if (r === "medium") return 2
return 1
}

function maxRisk(...risks: Risk[]): Risk {
const max = Math.max(...risks.map(riskRank))
if (max >= 3) return "high"
if (max >= 2) return "medium"
return "low"
}

function inferStatus(
total: number,
risk: Risk,
aiArtifactRisk: Risk,
voiceTypeRisk: Risk,
unsafePolicyRisk: Risk
): Status {
if (unsafePolicyRisk === "high" || risk === "high" || total < 55) return "HIGH_RISK"
if (aiArtifactRisk === "high" && total < 75) return "HIGH_RISK"
if (voiceTypeRisk === "high" && total < 75) return "HIGH_RISK"
if (total < 78 || risk === "medium" || aiArtifactRisk === "medium" || voiceTypeRisk === "medium") return "NEEDS_EDIT"
return "PASS"
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
temperature: 0.15,
max_tokens: 6500,
messages: [
{ role: "system", content: system },
{ role: "user", content: user }
]
})
})

clearTimeout(timer)

const raw = await res.text()
if (!res.ok) {
  return { text: "", error: "OpenAI " + res.status + ": " + raw.substring(0, 500) }
}

const data = JSON.parse(raw)
return { text: data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content || "" : "" }

} catch (e) {
clearTimeout(timer)
return { text: "", error: "OpenAI: " + (e as Error).message }
}
}

function buildSystemPrompt(): string {
const responseSchema = {
total_score: 0,
risk_level: "low|medium|high",
scores: {
reader_value: 0,
originality: 0,
eeat: 0,
policy_safety: 0,
engagement: 0,
commercial_potential: 0
},
verdict_ro: "short Romanian verdict",
verdict_en: "short English verdict",
must_fix_before_publish: ["..."],
recommendations: ["..."],
policy_risks: ["..."],
strengths: ["..."],
suggested_title_ro: null,
suggested_title_en: null,
suggested_excerpt_ro: null,
suggested_excerpt_en: null,
suggested_summary_ro: null,
suggested_summary_en: null,
suggested_editorial_notes: ["..."],
adsense_notes: {
low_value_content_risk: "low|medium|high",
thin_content_risk: "low|medium|high",
duplicate_or_rewrite_risk: "low|medium|high",
ai_footprint_risk: "low|medium|high",
unsafe_policy_risk: "low|medium|high",
advertiser_friendliness: "weak|acceptable|strong"
},
ai_artifact_review: {
score: 0,
risk: "low|medium|high",
issues: ["..."],
typography_issues: ["..."],
rhythm_issues: ["..."],
cliche_issues: ["..."],
quote_and_punctuation_issues: ["..."],
recommendations: ["..."]
},
voice_and_type_review: {
detected_editor_voice: null,
detected_article_type: "news|editorial|opinie|analiza|pamflet|blog|reportaj|cultura|tehnologie|unknown",
voice_preservation_score: 0,
type_preservation_score: 0,
risk: "low|medium|high",
issues: ["..."],
recommendations: ["..."]
},
source_comparison_review: {
available: false,
source_type: "scraped_article|article_source_material|editor_ai_source|url_only|none",
source_url: null,
similarity_risk: "low|medium|high",
quote_integrity_risk: "low|medium|high",
attribution_risk: "low|medium|high",
value_added_score: 0,
copied_or_near_copied_fragments: ["..."],
altered_or_unverified_quotes: ["..."],
missing_source_facts: ["..."],
added_value_detected: ["..."],
recommendations: ["..."]
}
}

return [
"You are the Transilvania Times AdSense Editorial Quality Reviewer v2.1.",
"",
"Your job:",
"Evaluate whether an article is ready for AdSense review and safe monetization while preserving the publication's editorial voices and article types.",
"",
"Important principles:",
"- Do not promise AdSense approval.",
"- Do not optimize for tricking Google.",
"- Do not flatten all articles into generic neutral prose.",
"- Optimize for real reader value, originality, trust, clarity, policy safety, advertiser friendliness, and credible human editing.",
"- AI-generated text is acceptable only when it is useful, original, factual, human-edited, well-sourced, non-generic and not mass-produced filler.",
"- Do not claim that AI detection can be made impossible.",
"- Instead, evaluate whether the article reads like credible, human-edited journalism.",
"- Evaluate both Romanian and English versions if both exist.",
"- Penalize thin content, generic rewrites, close paraphrase, missing sources, unsupported claims, fabricated quotes, vague language, policy-sensitive unsafe content, and visible synthetic-writing artifacts.",
"",
"Scoring:",
"- reader_value: 0-25",
"- originality: 0-20",
"- eeat: 0-20",
"- policy_safety: 0-15",
"- engagement: 0-10",
"- commercial_potential: 0-10",
"Total must be the sum, 0-100.",
"",
"AdSense/editorial quality:",
"- Reader value: Does the article answer a real reader need? Does it add useful context, local relevance, facts, explanation, or analysis?",
"- Originality: Is it genuinely restructured and original, not a cosmetic rewrite or generic summary?",
"- E-E-A-T: Are author, sourcing, attribution, specificity and editorial care visible?",
"- Policy safety: Check unsafe, misleading, hateful, shocking, adult, violent, exploitative, medical, financial, legal, political risk, unsupported allegations.",
"- Engagement: Is the lead strong, structure readable, and text worth finishing?",
"- Commercial potential: Would reputable advertisers be comfortable near it?",
"",
"AI artifact and typography review:",
"Evaluate visible synthetic-writing artifacts.",
"Check for excessive dashes, English quotation marks in Romanian copy, apostrophe misuse in Romanian, repeated sentence rhythm, suspiciously uniform paragraph length, repeated transition formulas, generic AI closers, artificial balance structures, excessive abstract nouns, corporate phrasing, source fabrication, English calques in Romanian, and text that feels like a summary instead of reporting.",
"",
"Romanian typography expectations:",
"- Use Romanian quotation marks for direct quotations.",
"- Avoid straight English quotes in final Romanian copy unless quoting code or technical strings.",
"- Avoid apostrophe-driven English typography in Romanian.",
"- Avoid em dash as a repeated tic.",
"- Use Romanian diacritics consistently.",
"",
"Source comparison review:",
"If original/source material is provided, compare the final article against it.",
"Flag copied or near-copied sentences, paragraph-order copying, cosmetic paraphrase, weak added value, missing attribution, and altered or invented quotes.",
"Quotes are strict: if a quote appears in the final article but not in the source, flag quote_integrity_risk as high unless it is clearly attributed to another documented source.",
"If a quote exists in the source but the final article changes its wording while keeping direct quotation marks, flag it as altered_or_unverified_quotes.",
"If the final article only expands the source with generic community/cultural filler, value_added_score must be low or medium.",
"If the article uses the same facts but adds clearer practical details, source attribution, local context, and a different structure, value_added_score can be higher.",
"",
"Voice and article type preservation:",
"The publication has distinct editors and article types. Evaluate quality inside the intended genre, not by forcing every article into generic hard news.",
"",
"Article type rules:",
"- news: factual, third-person, inverted pyramid, short paragraphs, attribution, no opinion, no first person.",
"- blog: first person allowed when experience or viewpoint is the point; must still provide reader value and concrete insight.",
"- analiza: methodical, structured, evidence-based; may have longer reasoning, but no academic filler.",
"- pamflet: satire and irony allowed; must avoid unverifiable attacks, vulgarity, protected-class attacks and family attacks.",
"- reportaj: scene and narrative allowed; must not invent witnesses, sensory details or quotes.",
"- tehnologie: precise technologies, tradeoffs, systems, vendors, jargon explained once, skeptical of hype.",
"- cultura: critical framing and longer sentences allowed; avoid empty reverence and generic praise.",
"- opinie: signed argument; personal judgment allowed but must be evidence-based, not a rant.",
"- editorial: clear institutional or signed position; evidence and real concession required.",
"",
"Editor voice rules:",
"- Strong voice is not a problem if it matches the expected editor and type.",
"- Penalize loss of voice, generic newsroom flattening, and style mismatch.",
"- Preserve Daniel Dobos as technical/business, precise, slightly cynical and systems-aware.",
"- Preserve Andrei Popescu as political/accountability, hard-hitting and evidence-driven.",
"- Preserve Lucian Bratu as local/cultural, warm and community-rooted.",
"- Preserve Elena Vasilescu as science/ideas, lyrical but rigorous.",
"- Preserve Sofia Marinescu as data/health, clinical and skeptical.",
"- Preserve Mihai Ionescu as systems/cybersecurity/infrastructure, precise and architectural.",
"- Preserve Victor Simon as wire news, economical and active voice.",
"",
"Return valid JSON only.",
"Do not include markdown.",
"Do not include explanations outside JSON.",
"",
"Return JSON using exactly this shape:",
JSON.stringify(responseSchema, null, 2)
].join("\n")
}


function buildUserPrompt(
post: BlogPost,
scan: HeuristicArtifactScan,
expectedArticleType: ArticleType,
expectedEditorKey: string | null,
sourceMaterial: SourceMaterial
): string {
const roWords = countWords(post.content_ro)
const enWords = countWords(post.content_en)
const totalWords = Math.max(roWords, enWords)

const expectedEditorVoice =
expectedEditorKey && EDITOR_VOICE_SUMMARY[expectedEditorKey]
? EDITOR_VOICE_SUMMARY[expectedEditorKey]
: "No explicit editor voice. Infer from author_name, ai_editor, category and text."

const articleTypeExpectation =
ARTICLE_TYPE_EXPECTATIONS[expectedArticleType] || ARTICLE_TYPE_EXPECTATIONS.unknown

return [
"Evaluate this Transilvania Times article for AdSense/editorial readiness.",
"",
"EXPECTED EDITOR AND TYPE",
"expected_editor_key: " + (expectedEditorKey || "unknown"),
"expected_editor_voice: " + expectedEditorVoice,
"expected_article_type: " + expectedArticleType,
"expected_article_type_rules: " + articleTypeExpectation,
"",
"ARTICLE METADATA",
"id: " + post.id,
"slug: " + (post.slug || ""),
"status: " + (post.status || ""),
"category: " + (post.category || ""),
"subcategory: " + (post.subcategory || ""),
"county: " + (post.county || ""),
"author_name: " + (post.author_name || ""),
"ai_editor: " + (post.ai_editor || ""),
"source_url: " + (post.source_url || ""),
"sources: " + (post.sources || []).join(", "),
"published_at: " + (post.published_at || ""),
"updated_at: " + (post.updated_at || ""),
"cover_image: " + (post.cover_image ? "yes" : "no"),
"cover_image_credit: " + (post.cover_image_credit || ""),
"word_count_ro: " + String(roWords),
"word_count_en: " + String(enWords),
"word_count_max_language: " + String(totalWords),
"",
"HEURISTIC AI ARTIFACT SCAN",
JSON.stringify(scan, null, 2),
"",
"SOURCE / ORIGINAL MATERIAL FOR COMPARISON",
"source_available: " + String(sourceMaterial.available),
"source_type: " + sourceMaterial.source_type,
"source_url: " + (sourceMaterial.source_url || ""),
"source_title: " + (sourceMaterial.source_title || ""),
"source_text:",
truncate(sourceMaterial.source_text, 9000),
"",
"ROMANIAN VERSION",
"title_ro:",
post.title_ro || "",
"",
"excerpt_ro:",
post.excerpt_ro || "",
"",
"summary_ro:",
post.summary_ro || "",
"",
"content_ro:",
truncate(post.content_ro, 9000),
"",
"tags_ro:",
JSON.stringify(post.tags_ro || []),
"",
"ENGLISH VERSION",
"title_en:",
post.title_en || "",
"",
"excerpt_en:",
post.excerpt_en || "",
"",
"summary_en:",
post.summary_en || "",
"",
"content_en:",
truncate(post.content_en, 9000),
"",
"tags_en:",
JSON.stringify(post.tags_en || []),
"",
"Evaluation instructions:",
"- Be strict but fair.",
"- Do not penalize a strong voice when it matches the editor and article type.",
"- Penalize generic flattening, style mismatch, synthetic rhythm, bad typography, thin content, lack of sourcing, generic rewrite, or unsupported claims.",
"- For Romanian copy, explicitly check whether quotation marks, apostrophes, dash usage and diacritics look like edited Romanian journalism.",
"- For blog, opinie and editorial, personal voice can be acceptable if disciplined and valuable.",
"- For news, reportaj, analiza, pamflet, cultura and tehnologie, apply the correct genre expectations rather than flattening all into news.",
"- Suggested titles, excerpts and summaries should preserve the intended voice and type."
].join("\n")
}

function normalizeReport(
raw: Record<string, unknown>,
post: BlogPost,
scan: HeuristicArtifactScan,
expectedArticleType: ArticleType,
expectedEditorKey: string | null,
sourceMaterial: SourceMaterial
): QualityReport {
const scoresRaw = (raw.scores || {}) as Record<string, unknown>

const scores = {
reader_value: clamp(scoresRaw.reader_value, 0, 25),
originality: clamp(scoresRaw.originality, 0, 20),
eeat: clamp(scoresRaw.eeat, 0, 20),
policy_safety: clamp(scoresRaw.policy_safety, 0, 15),
engagement: clamp(scoresRaw.engagement, 0, 10),
commercial_potential: clamp(scoresRaw.commercial_potential, 0, 10)
}

const summed =
scores.reader_value +
scores.originality +
scores.eeat +
scores.policy_safety +
scores.engagement +
scores.commercial_potential

const baseTotal = clamp(raw.total_score ?? summed, 0, 100)

const notesRaw = (raw.adsense_notes || {}) as Record<string, unknown>
const artifactRaw = (raw.ai_artifact_review || {}) as Record<string, unknown>
const voiceRaw = (raw.voice_and_type_review || {}) as Record<string, unknown>
const sourceRaw = (raw.source_comparison_review || {}) as Record<string, unknown>

const aiArtifactRisk = normalizeRisk(artifactRaw.risk)
const voiceTypeRisk = normalizeRisk(voiceRaw.risk)
const sourceSimilarityRisk = sourceMaterial.available ? normalizeRisk(sourceRaw.similarity_risk) : "low"
const sourceQuoteRisk = sourceMaterial.available ? normalizeRisk(sourceRaw.quote_integrity_risk) : "low"
const sourceAttributionRisk = sourceMaterial.available ? normalizeRisk(sourceRaw.attribution_risk) : (sourceMaterial.source_type === "url_only" ? "medium" : "low")

const adsenseNotes = {
low_value_content_risk: normalizeRisk(notesRaw.low_value_content_risk),
thin_content_risk: normalizeRisk(notesRaw.thin_content_risk),
duplicate_or_rewrite_risk: normalizeRisk(notesRaw.duplicate_or_rewrite_risk),
ai_footprint_risk: normalizeRisk(notesRaw.ai_footprint_risk),
unsafe_policy_risk: normalizeRisk(notesRaw.unsafe_policy_risk),
advertiser_friendliness: normalizeAdvertiser(notesRaw.advertiser_friendliness)
}

const risk = maxRisk(
normalizeRisk(raw.risk_level),
aiArtifactRisk,
voiceTypeRisk,
adsenseNotes.low_value_content_risk,
adsenseNotes.thin_content_risk,
adsenseNotes.duplicate_or_rewrite_risk,
adsenseNotes.ai_footprint_risk,
adsenseNotes.unsafe_policy_risk,
sourceSimilarityRisk,
sourceQuoteRisk,
sourceAttributionRisk
)

const status = inferStatus(
baseTotal,
risk,
aiArtifactRisk,
voiceTypeRisk,
adsenseNotes.unsafe_policy_risk
)

return {
ok: true,
post_id: post.id,
slug: post.slug || null,
total_score: baseTotal,
status: status,
risk_level: risk,
scores: scores,
verdict_ro: optionalString(raw.verdict_ro) || "Evaluare finalizată.",
verdict_en: optionalString(raw.verdict_en) || "Review completed.",
must_fix_before_publish: stringArray(raw.must_fix_before_publish),
recommendations: stringArray(raw.recommendations),
policy_risks: stringArray(raw.policy_risks),
strengths: stringArray(raw.strengths),
suggested_title_ro: optionalString(raw.suggested_title_ro),
suggested_title_en: optionalString(raw.suggested_title_en),
suggested_excerpt_ro: optionalString(raw.suggested_excerpt_ro),
suggested_excerpt_en: optionalString(raw.suggested_excerpt_en),
suggested_summary_ro: optionalString(raw.suggested_summary_ro),
suggested_summary_en: optionalString(raw.suggested_summary_en),
suggested_editorial_notes: stringArray(raw.suggested_editorial_notes),
adsense_notes: adsenseNotes,
ai_artifact_review: {
score: clamp(artifactRaw.score, 0, 100),
risk: aiArtifactRisk,
issues: stringArray(artifactRaw.issues),
typography_issues: stringArray(artifactRaw.typography_issues),
rhythm_issues: stringArray(artifactRaw.rhythm_issues),
cliche_issues: stringArray(artifactRaw.cliche_issues),
quote_and_punctuation_issues: stringArray(artifactRaw.quote_and_punctuation_issues),
recommendations: stringArray(artifactRaw.recommendations)
},
voice_and_type_review: {
expected_editor_key: expectedEditorKey,
expected_editor_voice:
expectedEditorKey && EDITOR_VOICE_SUMMARY[expectedEditorKey]
? EDITOR_VOICE_SUMMARY[expectedEditorKey]
: null,
detected_editor_voice: optionalString(voiceRaw.detected_editor_voice),
expected_article_type: expectedArticleType,
detected_article_type: normalizeArticleType(voiceRaw.detected_article_type),
voice_preservation_score: clamp(voiceRaw.voice_preservation_score, 0, 100),
type_preservation_score: clamp(voiceRaw.type_preservation_score, 0, 100),
risk: voiceTypeRisk,
issues: stringArray(voiceRaw.issues),
recommendations: stringArray(voiceRaw.recommendations)
},
source_comparison_review: {
available: sourceMaterial.available,
source_type: sourceMaterial.source_type,
source_url: sourceMaterial.source_url,
similarity_risk: sourceSimilarityRisk,
quote_integrity_risk: sourceQuoteRisk,
attribution_risk: sourceAttributionRisk,
value_added_score: sourceMaterial.available ? clamp(sourceRaw.value_added_score, 0, 100) : 0,
copied_or_near_copied_fragments: sourceMaterial.available ? stringArray(sourceRaw.copied_or_near_copied_fragments, 12) : [],
altered_or_unverified_quotes: sourceMaterial.available ? stringArray(sourceRaw.altered_or_unverified_quotes, 12) : [],
missing_source_facts: sourceMaterial.available ? stringArray(sourceRaw.missing_source_facts, 12) : [],
added_value_detected: sourceMaterial.available ? stringArray(sourceRaw.added_value_detected, 12) : [],
recommendations: sourceMaterial.available ? stringArray(sourceRaw.recommendations, 12) : (sourceMaterial.source_type === "url_only" ? ["Source URL exists, but original source text was not available for comparison.", "For scraped articles, verify scraped_article_id and original_content_full.", "For Editor AI/manual articles, add source_text in article_source_materials or pass source_text when running the check."] : [])
},
heuristic_artifact_scan: scan,
checked_at: new Date().toISOString(),
model: OPENAI_MODEL
}
}

async function loadSourceMaterial(supabase: any, post: BlogPost, body: any): Promise<SourceMaterial> {
const manualText = String(body.source_text || body.original_text || "").trim()
const manualTitle = String(body.source_title || body.original_title || "").trim()
const manualUrl = String(body.source_url || body.original_url || "").trim()

if (manualText) {
  return {
    available: true,
    source_type: "editor_ai_source",
    source_url: manualUrl || post.source_url || null,
    source_title: manualTitle || null,
    source_text: manualText
  }
}

if (post.scraped_article_id) {
  const { data: sourceData } = await supabase
    .from("scraped_articles")
    .select("original_title, original_content, original_content_full, original_url")
    .eq("id", post.scraped_article_id)
    .single()

  if (sourceData) {
    const text = String(sourceData.original_content_full || sourceData.original_content || "").trim()
    if (text) {
      return {
        available: true,
        source_type: "scraped_article",
        source_url: sourceData.original_url || post.source_url || null,
        source_title: sourceData.original_title || null,
        source_text: text
      }
    }
  }
}

const { data: materialData } = await supabase
  .from("article_source_materials")
  .select("source_type, source_url, source_title, source_text, updated_at")
  .eq("blog_post_id", post.id)
  .order("updated_at", { ascending: false })
  .limit(1)
  .maybeSingle()

if (materialData) {
  const text = String(materialData.source_text || "").trim()
  if (text) {
    return {
      available: true,
      source_type: "article_source_material",
      source_url: materialData.source_url || post.source_url || null,
      source_title: materialData.source_title || null,
      source_text: text
    }
  }
}

return {
  available: false,
  source_type: (manualUrl || post.source_url) ? "url_only" : "none",
  source_url: manualUrl || post.source_url || null,
  source_title: manualTitle || null,
  source_text: null
}
}

function thinContentReport(post: BlogPost, scan: HeuristicArtifactScan): QualityReport {
return {
ok: true,
post_id: post.id,
slug: post.slug || null,
total_score: 20,
status: "HIGH_RISK",
risk_level: "high",
scores: {
reader_value: 5,
originality: 5,
eeat: 3,
policy_safety: 5,
engagement: 1,
commercial_potential: 1
},
verdict_ro: "Articolul este prea scurt sau nu are suficient conținut editorial pentru evaluare AdSense.",
verdict_en: "The article is too short or lacks enough editorial content for AdSense review.",
must_fix_before_publish: [
"Adaugă conținut editorial complet înainte de publicare.",
"Completează titlul, lead-ul, rezumatul și corpul articolului.",
"Adaugă surse sau context verificabil."
],
recommendations: [
"Rescrie articolul ca material jurnalistic complet, nu ca notă scurtă.",
"Păstrează vocea editorului și tipul articolului, dar adaugă valoare concretă pentru cititor."
],
policy_risks: [],
strengths: [],
suggested_title_ro: null,
suggested_title_en: null,
suggested_excerpt_ro: null,
suggested_excerpt_en: null,
suggested_summary_ro: null,
suggested_summary_en: null,
suggested_editorial_notes: [
"Conținut insuficient pentru monetizare sigură."
],
adsense_notes: {
low_value_content_risk: "high",
thin_content_risk: "high",
duplicate_or_rewrite_risk: "medium",
ai_footprint_risk: "medium",
unsafe_policy_risk: "low",
advertiser_friendliness: "weak"
},
ai_artifact_review: {
score: 20,
risk: "high",
issues: ["Text insuficient pentru a evalua credibil ritmul, vocea și artifactele AI."],
typography_issues: [],
rhythm_issues: [],
cliche_issues: [],
quote_and_punctuation_issues: [],
recommendations: ["Completează articolul înainte de auditul stilistic."]
},
voice_and_type_review: {
expected_editor_key: null,
expected_editor_voice: null,
detected_editor_voice: null,
expected_article_type: "unknown",
detected_article_type: "unknown",
voice_preservation_score: 0,
type_preservation_score: 0,
risk: "medium",
issues: ["Text insuficient pentru evaluarea vocii editoriale."],
recommendations: ["Rulează verificarea după generare sau rescriere completă."]
},
source_comparison_review: {
available: false,
source_type: "none",
source_url: null,
similarity_risk: "low",
quote_integrity_risk: "low",
attribution_risk: "low",
value_added_score: 0,
copied_or_near_copied_fragments: [],
altered_or_unverified_quotes: [],
missing_source_facts: [],
added_value_detected: [],
recommendations: []
},
heuristic_artifact_scan: scan,
checked_at: new Date().toISOString(),
model: "heuristic"
}
}

// ---------------------------------------------------------------------------
// Inlined admin-authorization gate (self-contained; no _shared import needed).
// Allows only: (1) a trusted internal caller presenting this project's
// SUPABASE_SERVICE_ROLE_KEY as bearer, or (2) a logged-in admin (user JWT whose
// auth.uid() has an 'admin' row in public.user_roles). Everyone else -> 401/403.
// Fails closed. Dynamic import of createClient avoids clashing with existing imports.
// ---------------------------------------------------------------------------
async function requireAdmin(req: Request): Promise<Response | null> {
  const AUTH_CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...AUTH_CORS, 'Content-Type': 'application/json' },
    });
  }
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey && token === serviceKey) {
    return null;
  }
  // FIX (23 Aug 2026): the exact-match above is not sufficient. pg_cron jobs and
  // internal service-to-service calls send a service-role JWT that was hard-coded
  // into the caller (a cron job command, an env var, a config row). When the
  // project's service-role key is rotated or migrated to the new key format, that
  // hard-coded token stops matching SUPABASE_SERVICE_ROLE_KEY, execution falls
  // through to the user-JWT branch below, and every internal call returns 401.
  // weather-alert failed exactly this way on 12 consecutive cron runs (22-23 Aug
  // 2026) while still booting normally - the cron job itself reported "succeeded".
  // So also accept a token that PROVES it is service-role by performing an
  // operation only service-role may perform. GoTrue verifies the signature, so a
  // forged token or the public anon key still cannot pass this.
  try {
    const { createClient: _cc } = await import("https://esm.sh/@supabase/supabase-js@2");
    const _probe = _cc(Deno.env.get('SUPABASE_URL')!, token, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: _svcErr } = await _probe.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (!_svcErr) return null;
  } catch (_e) { /* not a service-role token - fall through to the admin-user check */ }
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabase = createClient(supabaseUrl, anonKey ?? serviceKey!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...AUTH_CORS, 'Content-Type': 'application/json' },
      });
    }
    const { data: roleRow, error: roleErr } = await supabase
      .from('user_roles').select('role').eq('user_id', userData.user.id)
      .eq('role', 'admin').maybeSingle();
    if (roleErr || !roleRow) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...AUTH_CORS, 'Content-Type': 'application/json' },
      });
    }
    return null;
  } catch (e) {
    console.error('[requireAdmin] check failed, denying by default:', (e as Error).message);
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...AUTH_CORS, 'Content-Type': 'application/json' },
    });
  }
}

serve(async function (req: Request) {
if (req.method === "OPTIONS") {
return new Response(null, { status: 204, headers: CORS })
}
// Admin-only. Service-role bearer (pg_cron) passes; a logged-in admin passes;
// everything else gets 401/403. Fails closed.
const denied = await requireAdmin(req);
if (denied) return denied;

if (req.method !== "POST") {
return plain("Method Not Allowed", 405)
}

try {
const SUPABASE_URL = getEnv("SUPABASE_URL")
const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY")

if (!SUPABASE_URL || !SERVICE_ROLE) {
  return json({ ok: false, error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" }, 500)
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
      "county",
      "tags_ro",
      "tags_en",
      "source_url",
      "sources",
      "scraped_article_id",
      "author_name",
      "ai_editor",
      "status",
      "published_at",
      "updated_at",
      "word_count",
      "cover_image",
      "cover_image_credit"
    ].join(", ")
  )
  .eq("id", postId)
  .single()

if (error || !data) {
  return json({
    ok: false,
    error: "Article not found: " + (error && error.message ? error.message : postId)
  }, 404)
}

const post = data as BlogPost
const sourceMaterial = await loadSourceMaterial(supabase, post, body)
const scan = heuristicScan(post)

const expectedArticleType = inferArticleType(post, body.expected_article_type)
const expectedEditorKey = inferEditorKey(post, body.expected_editor_key)

const hasContent =
  countWords(post.content_ro) >= 80 ||
  countWords(post.content_en) >= 80

if (!hasContent) {
  return json(thinContentReport(post, scan))
}

const system = buildSystemPrompt()
const user = buildUserPrompt(post, scan, expectedArticleType, expectedEditorKey, sourceMaterial)

const ai = await callOpenAI(system, user)

if (ai.error) {
  return json({ ok: false, error: ai.error }, 500)
}

const parsed = parseJsonSafe(ai.text)

if (!parsed) {
  return json({
    ok: false,
    error: "Could not parse AI JSON response",
    raw: ai.text.substring(0, 1000)
  }, 500)
}

const report = normalizeReport(parsed, post, scan, expectedArticleType, expectedEditorKey, sourceMaterial)
return json(report)

} catch (e) {
return json({
ok: false,
error: (e as Error).message || "Unknown error"
}, 500)
}
})

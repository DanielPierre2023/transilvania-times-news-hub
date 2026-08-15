// supabase/functions/tt-newsletter-digest/index.ts
//
// =============================================================================
// WEEKLY NEWSLETTER DIGEST — v6 (May 29, 2026)
// =============================================================================
//
// REPLACES: generate-weekly-newsletter (which generated a single AI essay
//           with no link to actual articles).
//
// CONTENT STRATEGY (Daniel's question 6 — proposed and built):
//
//   The digest is the answer to "what do we send?". It is a CURATED LINK
//   email, not a generated essay. Subscribers get:
//
//     1. EDITORIAL INTRO (~80 words, Claude Sonnet 4.6)
//        A single paragraph that reflects on the most important story of
//        the past 7 days in the subscriber's language. Written natively,
//        not translated. Generated fresh on Monday at 08:00 UTC.
//
//     2. REGIONAL TRANSYLVANIA (up to 3 stories)
//        Articles from the past 7 days whose source had scope='regional'
//        or county in (Cluj, Sibiu, Brașov, Mureș, Bistrița-Năsăud,
//        Sălaj, Maramureș, Alba, Harghita, Covasna, Hunedoara).
//
//     3. NATIONAL ROMANIA (up to 3 stories)
//        Articles whose source had scope='national'.
//
//     4. INTERNATIONAL (up to 2 stories, if any)
//        Articles whose source had scope='international'.
//
//     5. MOST READ THIS WEEK (up to 3 articles)
//        Ranked by view_count (if column present) or simple recency tie-breaker.
//        Distinct from the section picks (no duplicates).
//
//   Each article in each section is a single line: title + 1-sentence
//   excerpt, linking to https://transilvaniatimes.com/articol/<slug>
//
//   No subheadings, no AI essays, no fake editorial commentary. The
//   newsletter exists to deliver the week's journalism, not to write more.
//
// SCOPE RESOLUTION: blog_posts.scraped_article_id → scraped_articles.scope
//   gives us the per-article scope. Legacy posts without scraped_article_id
//   default to 'regional'.
//
// -----------------------------------------------------------------------------
// PHASE 3 (per-county segmentation) — minimal additions:
//   * Recipients now carry a nullable `county` slug.
//   * A recipient whose county has ≥1 recent post gets a county-flavored
//     digest: a LEAD "Știri din <County>" section followed by the unchanged
//     national/regional sections. Everyone else gets the unchanged national
//     digest. County posts are filtered from the ALREADY-FETCHED post set
//     (no per-county DB query).
//   * Footer gains a "Preferințe" link next to unsubscribe (same {{email}}
//     per-recipient replacement mechanism, now via replaceAll so both
//     placeholders resolve).
//   * The inlined admin gate is called right after the OPTIONS preflight.
// -----------------------------------------------------------------------------
//
// SELF-CONTAINED: brandedEmailV2 template inlined.
//
// Deploy: verify_jwt=true. Triggered by cron job at 08:00 UTC Monday.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SITE = 'https://transilvaniatimes.com'
const FROM = 'Transilvania Times <no-reply@transilvaniatimes.com>'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SONNET_MODEL = 'claude-sonnet-4-5-20250929'
const CALL_TIMEOUT_MS = 60000

const TRANSYLVANIA_COUNTIES = [
  'Cluj', 'Sibiu', 'Brașov', 'Mureș', 'Bistrița-Năsăud',
  'Sălaj', 'Maramureș', 'Alba', 'Harghita', 'Covasna', 'Hunedoara',
]

// ─────────────────────────────────────────────────────────────────────────────
// INLINED ADMIN GATE
// ─────────────────────────────────────────────────────────────────────────────

async function requireAdmin(req: Request): Promise<Response | null> {
  const AUTH_CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...AUTH_CORS, 'Content-Type': 'application/json' } });
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey && token === serviceKey) return null;
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') ?? serviceKey!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...AUTH_CORS, 'Content-Type': 'application/json' } });
    const { data: roleRow, error: roleErr } = await supabase.from('user_roles').select('role').eq('user_id', userData.user.id).eq('role', 'admin').maybeSingle();
    if (roleErr || !roleRow) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...AUTH_CORS, 'Content-Type': 'application/json' } });
    return null;
  } catch (e) { console.error('[requireAdmin] denying:', (e as Error).message); return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...AUTH_CORS, 'Content-Type': 'application/json' } }); }
}

// ─────────────────────────────────────────────────────────────────────────────
// County slug normalization (PHASE 3)
//   'Bistrița-Năsăud' -> 'bistrita-nasaud', 'Cluj' -> 'cluj'
// ─────────────────────────────────────────────────────────────────────────────

function normalizeCounty(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
}

// ─────────────────────────────────────────────────────────────────────────────
// BRANDED EMAIL TEMPLATE — inlined
// ─────────────────────────────────────────────────────────────────────────────

interface EmailCta { label: string; url: string }
interface BrandedEmailV2Opts {
  lang: 'ro' | 'en'
  preheaderRo?: string
  preheaderEn?: string
  heading: string
  bodyHtml: string
  cta?: EmailCta
  footerExtra?: string
}

function brandedEmailV2(opts: BrandedEmailV2Opts): string {
  const isRo = opts.lang === 'ro'
  const year = new Date().getFullYear()
  const preheader = isRo
    ? (opts.preheaderRo || 'DIGEST SĂPTĂMÂNAL · ' + new Date().toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase())
    : (opts.preheaderEn || 'WEEKLY DIGEST · ' + new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase())
  const footerCopy = isRo
    ? `&copy; ${year} Transilvania Times · Cluj-Napoca, România`
    : `&copy; ${year} Transilvania Times · Cluj-Napoca, Romania`
  const privacy = isRo ? 'Politică de confidențialitate' : 'Privacy policy'
  const unsub   = isRo ? 'Dezabonare' : 'Unsubscribe'
  const prefs   = isRo ? 'Preferințe' : 'Preferences'

  const ctaBlock = opts.cta
    ? `<table cellpadding="0" cellspacing="0" align="center" style="margin:32px auto 8px;"><tr><td style="background:#C41E3A;"><a href="${opts.cta.url}" style="display:inline-block;padding:14px 36px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:0.1em;text-transform:uppercase;">${opts.cta.label} →</a></td></tr></table>`
    : ''

  return `<!DOCTYPE html>
<html lang="${opts.lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${opts.heading}</title></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
<tr><td align="center"><table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;">
<tr><td style="background:#C41E3A;padding:36px 48px;text-align:center;border-bottom:4px solid #a01830;">
<p style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:700;font-style:italic;color:#ffffff;letter-spacing:-0.5px;">Transilvania Times</p>
<p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.75);letter-spacing:0.2em;text-transform:uppercase;">${preheader}</p>
</td></tr>
<tr><td style="padding:40px 48px;">
<h1 style="margin:0 0 22px;font-family:Georgia,serif;font-size:24px;line-height:1.3;color:#1a1a1a;font-weight:700;">${opts.heading}</h1>
<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#444;">${opts.bodyHtml}</div>${ctaBlock}
</td></tr>
<tr><td style="background:#f5f4f0;padding:24px 48px;border-top:1px solid #e5e2d9;text-align:center;">
${opts.footerExtra ? `<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:12px;color:#888;line-height:1.6;">${opts.footerExtra}</p>` : ''}
<p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#999;"><a href="${SITE}" style="color:#999;text-decoration:none;">transilvaniatimes.com</a> &nbsp;·&nbsp; <a href="${SITE}/politica-confidentialitate" style="color:#999;text-decoration:underline;">${privacy}</a> &nbsp;·&nbsp; <a href="${SITE}/preferinte?email={{email}}" style="color:#999;text-decoration:underline;">${prefs}</a> &nbsp;·&nbsp; <a href="${SITE}/dezabonare?email={{email}}" style="color:#999;text-decoration:underline;">${unsub}</a></p>
<p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#bbb;">${footerCopy}</p>
</td></tr>
</table></td></tr>
</table></body></html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// Article fetching
// ─────────────────────────────────────────────────────────────────────────────

interface ArticleSummary {
  id:           string
  slug:         string
  title_ro:     string
  title_en:     string
  excerpt_ro:   string
  excerpt_en:   string
  category:     string | null
  published_at: string
  scope:        'regional' | 'national' | 'international' | 'unknown'
  view_count:   number
  county:       string | null   // PHASE 3: normalized county slug (e.g. 'cluj'), or null
  countyLabel:  string | null   // PHASE 3: raw display label (e.g. 'Cluj'), or null
}

// deno-lint-ignore no-explicit-any
async function fetchWeeklyArticles(supabase: any): Promise<ArticleSummary[]> {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: posts } = await supabase
    .from('blog_posts')
    .select(`
      id, slug, title_ro, title_en, excerpt_ro, excerpt_en,
      category, published_at, scraped_article_id, view_count
    `)
    .eq('status', 'published')
    .gte('published_at', oneWeekAgo)
    .order('published_at', { ascending: false })
    .limit(40)

  if (!posts || posts.length === 0) return []

  // Resolve scope via scraped_articles
  const scrapedIds = posts
    .map((p: { scraped_article_id: string | null }) => p.scraped_article_id)
    .filter((id: string | null): id is string => !!id)

  let scopeMap: Map<string, string> = new Map()
  let countyMap: Map<string, string | null> = new Map()
  if (scrapedIds.length > 0) {
    const { data: scraped } = await supabase
      .from('scraped_articles')
      .select('id, scope, county')
      .in('id', scrapedIds)
    if (scraped) {
      for (const s of scraped as Array<{ id: string; scope: string | null; county: string | null }>) {
        scopeMap.set(s.id, s.scope || 'unknown')
        countyMap.set(s.id, s.county)
      }
    }
  }

  return (posts as Array<{
    id: string; slug: string; title_ro: string; title_en: string;
    excerpt_ro: string; excerpt_en: string; category: string | null;
    published_at: string; scraped_article_id: string | null; view_count: number | null
  }>).map((p) => {
    const rawScope = p.scraped_article_id ? scopeMap.get(p.scraped_article_id) : null
    const county   = p.scraped_article_id ? countyMap.get(p.scraped_article_id) : null
    let scope: ArticleSummary['scope']
    if (rawScope === 'regional' || rawScope === 'national' || rawScope === 'international') {
      scope = rawScope
    } else if (county && TRANSYLVANIA_COUNTIES.includes(county)) {
      scope = 'regional'  // legacy fallback
    } else {
      scope = 'national'  // safe default
    }
    const rawCounty = county ?? null
    return {
      id: p.id, slug: p.slug,
      title_ro: p.title_ro || '', title_en: p.title_en || '',
      excerpt_ro: p.excerpt_ro || '', excerpt_en: p.excerpt_en || '',
      category: p.category, published_at: p.published_at, scope,
      view_count: p.view_count || 0,
      county: rawCounty ? normalizeCounty(rawCounty) : null,
      countyLabel: rawCounty,
    }
  })
}

function bucketize(articles: ArticleSummary[]): {
  regional:      ArticleSummary[]
  national:      ArticleSummary[]
  international: ArticleSummary[]
  mostRead:      ArticleSummary[]
} {
  const regional      = articles.filter(a => a.scope === 'regional').slice(0, 3)
  const national      = articles.filter(a => a.scope === 'national').slice(0, 3)
  const international = articles.filter(a => a.scope === 'international').slice(0, 2)

  const picked = new Set<string>([
    ...regional.map(a => a.id),
    ...national.map(a => a.id),
    ...international.map(a => a.id),
  ])
  const mostRead = articles
    .filter(a => !picked.has(a.id))
    .sort((a, b) => b.view_count - a.view_count)
    .slice(0, 3)

  return { regional, national, international, mostRead }
}

// ─────────────────────────────────────────────────────────────────────────────
// Editorial intro paragraph — Claude Sonnet
// ─────────────────────────────────────────────────────────────────────────────

async function generateEditorialIntro(lang: 'ro' | 'en', topArticles: ArticleSummary[]): Promise<string> {
  const apiKey = Deno.env.get('CLAUDE_API_KEY')
  if (!apiKey || topArticles.length === 0) return ''

  const topList = topArticles.slice(0, 8).map((a) => {
    const title   = lang === 'ro' ? a.title_ro   : a.title_en
    const excerpt = lang === 'ro' ? a.excerpt_ro : a.excerpt_en
    return `- [${a.scope}] ${title} — ${excerpt}`
  }).join('\n')

  const system = lang === 'ro'
    ? `Ești redactorul-șef al Transilvania Times. Scrii UN SINGUR paragraf scurt (80–100 de cuvinte) la începutul digest-ului săptămânal. Identifici tema dominantă a săptămânii și o conturezi în cuvintele tale, fără să rezumi articolele individual. Voce: editorial sobru, nu publicitar. Fără adjective de impact ("șocant", "remarcabil"). Fără "în această săptămână" repetat. Începi direct cu o observație. Diacritice obligatorii.`
    : `You are the editor of Transilvania Times. Write ONE short paragraph (80–100 words) opening the weekly digest. Identify the dominant theme of the week and outline it in your own words — do not summarize articles individually. Voice: sober editorial, not promotional. No impact adjectives ("shocking", "remarkable"). No repeated "this week". Open with a direct observation.`

  const user = lang === 'ro'
    ? `Articolele publicate în ultimele 7 zile:\n\n${topList}\n\nScrie paragraful introductiv. UN paragraf, fără titlu, fără bullet points.`
    : `Articles published in the past 7 days:\n\n${topList}\n\nWrite the opening paragraph. ONE paragraph, no heading, no bullet points.`

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: 400,
        temperature: 0.7,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    clearTimeout(t)
    if (!res.ok) return ''
    const data = await res.json()
    // deno-lint-ignore no-explicit-any
    return ((data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim())
  } catch {
    clearTimeout(t)
    return ''
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Digest HTML composer
// ─────────────────────────────────────────────────────────────────────────────

function articleLinkBlock(lang: 'ro' | 'en', a: ArticleSummary): string {
  const title   = lang === 'ro' ? a.title_ro   : a.title_en
  const excerpt = lang === 'ro' ? a.excerpt_ro : a.excerpt_en
  const url     = `${SITE}/articol/${a.slug}`
  return `<div style="margin:0 0 18px;padding:0 0 18px;border-bottom:1px solid #f0ede6;">
    <a href="${url}" style="font-family:Georgia,serif;font-size:17px;font-weight:700;color:#1a1a1a;text-decoration:none;line-height:1.35;">${title}</a>
    <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#666;">${excerpt}</p>
    <p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;"><a href="${url}" style="color:#C41E3A;text-decoration:none;letter-spacing:0.05em;text-transform:uppercase;font-weight:600;">${lang === 'ro' ? 'Citește articolul' : 'Read article'} →</a></p>
  </div>`
}

function sectionBlock(lang: 'ro' | 'en', label: string, articles: ArticleSummary[]): string {
  if (articles.length === 0) return ''
  return `<h2 style="margin:32px 0 18px;font-family:Georgia,serif;font-size:13px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#C41E3A;border-bottom:2px solid #C41E3A;padding-bottom:8px;">${label}</h2>
  ${articles.map((a) => articleLinkBlock(lang, a)).join('')}`
}

// PHASE 3: intro block + the national section stack, split out so the county
// variant can reuse the exact same national layout after its lead section.
function introBlockHtml(intro: string): string {
  return intro
    ? `<div style="margin:0 0 28px;padding:18px 22px;background:#f5f4f0;border-left:3px solid #C41E3A;font-family:Georgia,serif;font-size:14px;line-height:1.7;color:#333;font-style:italic;">${intro}</div>`
    : ''
}

function nationalSections(lang: 'ro' | 'en', buckets: ReturnType<typeof bucketize>): string {
  return [
    sectionBlock(lang, lang === 'ro' ? 'Regional · Transilvania' : 'Regional · Transylvania', buckets.regional),
    sectionBlock(lang, lang === 'ro' ? 'Național · România'      : 'National · Romania',      buckets.national),
    sectionBlock(lang, lang === 'ro' ? 'Internațional'           : 'International',           buckets.international),
    sectionBlock(lang, lang === 'ro' ? 'Cele mai citite'         : 'Most read this week',     buckets.mostRead),
  ].filter(Boolean).join('')
}

function buildDigestBody(
  lang: 'ro' | 'en',
  intro: string,
  buckets: ReturnType<typeof bucketize>,
): string {
  return introBlockHtml(intro) + nationalSections(lang, buckets)
}

// PHASE 3: county-flavored digest — LEAD "Știri din <County>" section built from
// the ALREADY-FETCHED posts, then the unchanged national/regional stack.
function buildCountyDigestBody(
  lang: 'ro' | 'en',
  intro: string,
  countyLabel: string,
  countyPosts: ArticleSummary[],
  buckets: ReturnType<typeof bucketize>,
): string {
  const leadTitle = lang === 'ro' ? `Știri din ${countyLabel}` : `News from ${countyLabel}`
  const lead = sectionBlock(lang, leadTitle, countyPosts.slice(0, 5))
  return introBlockHtml(intro) + lead + nationalSections(lang, buckets)
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipients
// ─────────────────────────────────────────────────────────────────────────────

interface Recipient { email: string; language: 'ro' | 'en'; county: string | null }

// deno-lint-ignore no-explicit-any
async function fetchRecipients(supabase: any): Promise<Recipient[]> {
  // ONLY confirmed, active, not-unsubscribed newsletter_subscribers.
  // Contacts are NOT in the newsletter recipient pool (per Daniel's v6 decision).
  const { data } = await supabase
    .from('newsletter_subscribers')
    .select('email, language, county')
    .eq('confirmed', true)
    .eq('is_active', true)
    .is('unsubscribed_at', null)

  if (!data) return []
  return (data as Array<{ email: string; language: string; county: string | null }>)
    .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))
    .map((r) => ({
      email: r.email,
      language: (r.language === 'en' ? 'en' : 'ro') as 'ro' | 'en',
      county: r.county ? normalizeCounty(r.county) : null,
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Sender
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlPair { ro: string; en: string }

async function sendBatch(
  recipients: Recipient[],
  subject: { ro: string; en: string },
  nationalHtml: HtmlPair,
  countyHtml: Map<string, HtmlPair>,
): Promise<number> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return 0

  let sent = 0
  for (const r of recipients) {
    const subj = r.language === 'en' ? subject.en : subject.ro
    // PHASE 3: pick the county segment when the recipient's county has posts,
    // otherwise fall back to the national digest.
    const seg = (r.county && countyHtml.has(r.county)) ? countyHtml.get(r.county)! : nationalHtml
    // replaceAll so BOTH the preferences and unsubscribe {{email}} placeholders resolve.
    const htmlBody = (r.language === 'en' ? seg.en : seg.ro).replaceAll('{{email}}', encodeURIComponent(r.email))

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        from: FROM,
        to: [r.email],
        subject: subj,
        html: htmlBody,
        reply_to: 'contact@transilvaniatimes.com',
      }),
    })
    if (res.ok) sent++
    else console.error(`[digest] send failed for ${r.email}: ${res.status}`)

    // Resend free tier is 2 req/sec — sleep 600ms between sends
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  return sent
}

// ─────────────────────────────────────────────────────────────────────────────
// Serve
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const gate = await requireAdmin(req)
  if (gate) return gate

  try {
    const body = await req.json().catch(() => ({})) as {
      preview?: boolean      // if true, return HTML without sending
      preview_email?: string // if set, send to this address only (for testing)
      source?:  string
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Fetch week's articles
    const articles = await fetchWeeklyArticles(supabase)
    if (articles.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'No articles published in last 7 days; digest skipped' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // 2. Bucket
    const buckets = bucketize(articles)

    // 3. Generate intros (parallel)
    const [introRo, introEn] = await Promise.all([
      generateEditorialIntro('ro', articles),
      generateEditorialIntro('en', articles),
    ])

    // 4. Build HTML
    const dateStr = new Date().toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })
    const headingRo = `Digestul săptămânii — ${dateStr}`
    const headingEn = `This week in Transylvania — ${new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}`

    const ctaRo: EmailCta = { label: 'TOATE ARTICOLELE SĂPTĂMÂNII', url: `${SITE}/articole` }
    const ctaEn: EmailCta = { label: 'ALL THIS WEEKS ARTICLES', url: `${SITE}/articole` }

    const htmlRo = brandedEmailV2({
      lang: 'ro',
      heading: headingRo,
      bodyHtml: buildDigestBody('ro', introRo, buckets),
      cta: ctaRo,
    })
    const htmlEn = brandedEmailV2({
      lang: 'en',
      heading: headingEn,
      bodyHtml: buildDigestBody('en', introEn, buckets),
      cta: ctaEn,
    })
    const nationalHtml: HtmlPair = { ro: htmlRo, en: htmlEn }

    // PHASE 3: which recent counties have at least one post?
    const countiesWithPosts = new Set(
      articles.map((a) => a.county).filter((c): c is string => !!c),
    )

    const subjectRo = `Transilvania Times — Digestul săptămânii (${dateStr})`
    const subjectEn = `Transilvania Times — Weekly digest (${dateStr})`

    // 5. Preview mode — no sending (national variant is fine)
    if (body.preview) {
      return new Response(JSON.stringify({ ok: true, preview: true, htmlRo, htmlEn, subjectRo, subjectEn, bucketCounts: {
        regional: buckets.regional.length, national: buckets.national.length,
        international: buckets.international.length, mostRead: buckets.mostRead.length,
      } }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    // 6. Preview-email mode — single recipient (national variant)
    if (body.preview_email) {
      const sent = await sendBatch(
        [{ email: body.preview_email, language: 'ro', county: null }],
        { ro: subjectRo, en: subjectEn },
        nationalHtml,
        new Map(),
      )
      return new Response(JSON.stringify({ ok: sent === 1, sent }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // 7. Full broadcast
    const recipients = await fetchRecipients(supabase)
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'No confirmed subscribers' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // PHASE 3: build a county-flavored digest only for counties that both have
    // recent posts AND have at least one recipient. No per-county DB query —
    // posts are filtered from the already-fetched set.
    const neededCounties = new Set(
      recipients
        .map((r) => r.county)
        .filter((c): c is string => !!c && countiesWithPosts.has(c)),
    )
    const countyHtml = new Map<string, HtmlPair>()
    for (const slug of neededCounties) {
      const countyPosts = articles.filter((a) => a.county === slug)
      if (countyPosts.length === 0) continue
      const label = countyPosts[0].countyLabel || slug
      countyHtml.set(slug, {
        ro: brandedEmailV2({
          lang: 'ro',
          heading: headingRo,
          bodyHtml: buildCountyDigestBody('ro', introRo, label, countyPosts, buckets),
          cta: ctaRo,
        }),
        en: brandedEmailV2({
          lang: 'en',
          heading: headingEn,
          bodyHtml: buildCountyDigestBody('en', introEn, label, countyPosts, buckets),
          cta: ctaEn,
        }),
      })
    }

    const sent = await sendBatch(
      recipients,
      { ro: subjectRo, en: subjectEn },
      nationalHtml,
      countyHtml,
    )

    // 8. Log the campaign
    await supabase.from('newsletter_campaigns').insert([
      {
        subject:          subjectRo,
        content:          htmlRo,
        status:           'sent',
        sent_at:          new Date().toISOString(),
        recipient_count:  recipients.filter((r) => r.language === 'ro').length,
        target_language:  'ro',
      },
      {
        subject:          subjectEn,
        content:          htmlEn,
        status:           'sent',
        sent_at:          new Date().toISOString(),
        recipient_count:  recipients.filter((r) => r.language === 'en').length,
        target_language:  'en',
      },
    ])

    return new Response(JSON.stringify({
      ok: true,
      sent,
      recipients_total: recipients.length,
      county_segments: [...countyHtml.keys()],
      bucket_counts: {
        regional: buckets.regional.length,
        national: buckets.national.length,
        international: buckets.international.length,
        most_read: buckets.mostRead.length,
      },
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})

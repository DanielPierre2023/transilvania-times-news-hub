// supabase/functions/tt-scrape-rss/index.ts
//
// =============================================================================
// RSS SCRAPER — v7 (Aug 2026)
// =============================================================================
//
// v7 FIX — content extraction no longer captures CSS/JS as "article text".
//   Symptom: sites built on the tagDiv/Newspaper WordPress theme (and many
//   others) inline large <style> blocks INSIDE the article markup. The old
//   stripHtml() removed the <style> TAGS but left the CSS TEXT between them,
//   so original_content_full became 25k chars of `.tdi_50{min-height:0}…`.
//   The processor then rejected it with "SOURCE_INVALID: avg word length … not
//   prose". Now we strip <style>/<script>/<noscript>/comment CONTENTS before
//   any parsing, and scrub residual CSS rules, so only real prose is stored.
//
// Earlier fixes retained:
//   1. Honors rss_sources.output_limit (not hardcoded 20)
//   2. URL deduplication against scraped_articles
//   3. Accepts { source_id } for single-source scrape
//
// CALL SHAPES:
//   { source: 'cron' }        → batch over active sources, if scraper_enabled
//   { source_id: '<uuid>' }   → scrape one source (admin)
//   { }                       → batch over all active sources (admin)
//
// Deploy: verify_jwt as currently configured.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type SupaClient = ReturnType<typeof createClient<any, any, any>>

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FETCH_TIMEOUT_MS  = 20000
const ARTICLE_TIMEOUT_MS = 15000
const USER_AGENT = 'Mozilla/5.0 (compatible; TransilvaniaTimes/1.0; +https://transilvaniatimes.com)'

// =============================================================================
// RSS parsing utilities
// =============================================================================

function extractText(xml: string, tag: string): string {
  const cdata = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'))
  if (cdata) return cdata[1].trim()
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? m[1].trim() : ''
}

// Remove the CONTENTS of non-prose blocks (style/script/etc.) before anything
// else. This is what fixes the "CSS captured as article" bug.
function stripNonProse(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
}

function stripHtml(html: string): string {
  return stripNonProse(html)
    .replace(/<[^>]+>/g, ' ')
    // scrub residual CSS rules that slipped through as text (e.g. inline JSON-LD
    // or style attributes rendered as content): "@media …{…}", ".class{…}", "#id{…}"
    .replace(/@[a-z-]+[^{]*\{[\s\S]*?\}/gi, ' ')
    .replace(/[.#][a-zA-Z][\w-]*(?:\s*,\s*[.#][\w-]+)*\s*\{[^}]*\}/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/\s+/g, ' ').trim()
}

// Prose sanity: real article text has short-ish average word length. CSS/markup
// junk pushes this well past ~15. Mirrors the processor's guard so we never
// store something the processor will reject.
function looksLikeProse(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 40) return false
  const avg = words.reduce((a, w) => a + w.length, 0) / words.length
  return avg <= 12
}

async function fetchFullArticle(url: string): Promise<{ body: string; wordCount: number }> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), ARTICLE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    })
    clearTimeout(t)
    if (!res.ok) return { body: '', wordCount: 0 }

    // Strip style/script/etc. CONTENTS up front so no strategy can capture CSS.
    const html = stripNonProse(await res.text())
    let content = ''

    // Strategy 1: <article>
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    if (articleMatch) content = articleMatch[1]

    // Strategy 2: known content containers
    if (!content || stripHtml(content).split(/\s+/).length < 100) {
      const selectors = [
        /<div[^>]*class="[^"]*(?:article-body|post-content|entry-content|article-content|story-body|article__body|td-post-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*id="[^"]*(?:article-body|post-content|entry-content|article-content|story-body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<main[^>]*>([\s\S]*?)<\/main>/i,
      ]
      for (const sel of selectors) {
        const m = html.match(sel)
        if (m && stripHtml(m[1]).split(/\s+/).length > 100) { content = m[1]; break }
      }
    }

    // Strategy 3: all <p> in <body> (most robust — always clean paragraphs)
    if (!content || stripHtml(content).split(/\s+/).length < 100 || !looksLikeProse(stripHtml(content))) {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
      if (bodyMatch) {
        const paragraphs = bodyMatch[1].match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []
        const meaningful = paragraphs.map(p => stripHtml(p)).filter(p => p.split(/\s+/).length > 8)
        const joined = meaningful.join('\n\n')
        if (joined.split(/\s+/).length > 60) content = joined
      }
    }

    if (!content) return { body: '', wordCount: 0 }
    // If Strategy 1/2 gave HTML, clean it; Strategy 3 is already clean text.
    const cleaned = /<[a-z]/i.test(content) ? stripHtml(content) : content.replace(/\s+/g, ' ').trim()
    // Final guard: never return CSS/markup soup.
    if (!looksLikeProse(cleaned)) return { body: '', wordCount: 0 }
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length
    return { body: cleaned.slice(0, 25000), wordCount }
  } catch {
    clearTimeout(t)
    return { body: '', wordCount: 0 }
  }
}

interface FeedItem {
  title: string
  url: string
  contentSnippet: string
  contentFull: string
  sourceWordCount: number
}

async function fetchFeed(feedUrl: string, limit: number): Promise<FeedItem[]> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(feedUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    })
    clearTimeout(t)
    if (!res.ok) return []
    const xml = await res.text()

    const items: FeedItem[] = []
    const itemRegex = /<(item|entry)[\s>]([\s\S]*?)<\/\1>/gi
    let match
    while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
      const block = match[2]
      const title = stripHtml(extractText(block, 'title'))
      const link = block.match(/<link[^>]*href="([^"]+)"/)?.[1] || extractText(block, 'link')
      const rawContent = extractText(block, 'content:encoded') ||
                         extractText(block, 'description') ||
                         extractText(block, 'summary') ||
                         extractText(block, 'content')
      const snippet = stripHtml(rawContent)

      if (title && link) {
        const { body: fullBody, wordCount } = await fetchFullArticle(link)
        // Fall back to the (clean) feed snippet if the page fetch didn't yield prose.
        const full = fullBody || snippet.slice(0, 25000)
        items.push({
          title,
          url: link,
          contentSnippet: snippet.slice(0, 8000),
          contentFull: full,
          sourceWordCount: wordCount || snippet.split(/\s+/).filter(Boolean).length,
        })
      }
    }
    return items
  } catch {
    clearTimeout(t)
    return []
  }
}

// =============================================================================
// Per-source ingest with dedup
// =============================================================================

interface SourceRow {
  id: string
  name: string
  url: string
  category: string | null
  source_language: string | null
  county: string | null
  scope: string | null
  source_type: string | null
  target_category: string | null
  output_limit: number | null
}

interface IngestResult {
  sourceId: string
  sourceName: string
  fetched: number
  inserted: number
  skipped_duplicates: number
  errors: number
  error_message?: string
}

async function ingestSource(supabase: SupaClient, source: SourceRow): Promise<IngestResult> {
  const result: IngestResult = {
    sourceId: source.id,
    sourceName: source.name,
    fetched: 0,
    inserted: 0,
    skipped_duplicates: 0,
    errors: 0,
  }

  const limit = Math.max(1, Math.min(50, source.output_limit ?? 10))
  const items = await fetchFeed(source.url, limit)
  result.fetched = items.length

  if (items.length === 0) {
    result.error_message = 'No items fetched from feed'
    await supabase.from('rss_sources')
      .update({
        last_scraped_at: new Date().toISOString(),
        error_count: 1,
        error_message: 'Empty feed or fetch error',
      }).eq('id', source.id)
    return result
  }

  const urls = items.map(i => i.url)
  const { data: existing } = await supabase
    .from('scraped_articles')
    .select('original_url')
    .in('original_url', urls)
  const existingSet = new Set((existing || []).map(r => (r as { original_url: string }).original_url))

  for (const item of items) {
    if (existingSet.has(item.url)) {
      result.skipped_duplicates++
      continue
    }
    const { error } = await supabase
      .from('scraped_articles')
      .insert({
        source_id:             source.id,
        original_title:        item.title,
        original_url:          item.url,
        original_content:      item.contentSnippet,
        original_content_full: item.contentFull,
        source_word_count:     item.sourceWordCount,
        status:                'scraped',
        category:              source.category,
        county:                source.county,
        scope:                 source.scope,
        source_type:           source.source_type,
        target_category:       source.target_category,
        is_used:               false,
        marked_for_deletion:   false,
      })
    if (error) {
      if (error.code === '23505') {
        result.skipped_duplicates++
      } else {
        result.errors++
        console.error(`[scraper] insert error for ${item.url}: ${error.message}`)
      }
    } else {
      result.inserted++
    }
  }

  await supabase.from('rss_sources')
    .update({
      last_scraped_at: new Date().toISOString(),
      error_count: result.errors > 0 ? result.errors : 0,
      error_message: result.errors > 0 ? `${result.errors} insert errors` : null,
    }).eq('id', source.id)

  return result
}

// =============================================================================
// Serve
// =============================================================================

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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  // Admin-only. Service-role bearer (pg_cron) passes; a logged-in admin passes;
  // everything else gets 401/403. Fails closed.
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({})) as {
      source_id?: string
      source?: 'cron' | 'admin' | string
    }

    const supabase: SupaClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const fromCron = body.source === 'cron'

    const { data: settings } = await supabase
      .from('automation_settings')
      .select('scraper_enabled')
      .eq('id', 1)
      .maybeSingle()
    const scraperEnabled = settings ? (settings as { scraper_enabled: boolean }).scraper_enabled : false

    if (fromCron && !scraperEnabled) {
      console.log('[cron] scraper disabled; exiting')
      return new Response(JSON.stringify({ ok: true, skipped: 'scraper_disabled' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (body.source_id) {
      const { data: src, error } = await supabase
        .from('rss_sources')
        .select('id, name, url, category, source_language, county, scope, source_type, target_category, output_limit, is_active')
        .eq('id', body.source_id)
        .single()
      if (error || !src) {
        return new Response(JSON.stringify({ ok: false, error: 'Source not found' }), {
          status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }
      const result = await ingestSource(supabase, src as SourceRow)
      return new Response(JSON.stringify({
        ok: true,
        source: result.sourceName,
        fetched: result.fetched,
        inserted: result.inserted,
        skipped_duplicates: result.skipped_duplicates,
        errors: result.errors,
        total_scraped: result.inserted,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const { data: sources } = await supabase
      .from('rss_sources')
      .select('id, name, url, category, source_language, county, scope, source_type, target_category, output_limit')
      .eq('is_active', true)
      .order('name', { ascending: true })

    const list = (sources || []) as SourceRow[]
    const results: IngestResult[] = []
    let totalInserted = 0
    let totalDuplicates = 0
    for (const s of list) {
      const r = await ingestSource(supabase, s)
      results.push(r)
      totalInserted += r.inserted
      totalDuplicates += r.skipped_duplicates
    }

    return new Response(JSON.stringify({
      ok: true,
      sources_processed: list.length,
      total_scraped: totalInserted,
      total_duplicates_skipped: totalDuplicates,
      results,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})

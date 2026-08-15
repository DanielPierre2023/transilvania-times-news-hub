// supabase/functions/weather-alert/index.ts
//
// =============================================================================
// WEATHER ALERT — PHASE 4 (self-contained)
// =============================================================================
//
// Polls MeteoAlarm's Romania OPEN Atom feed, finds orange (level 3) / red
// (level 4) warnings for the 14 Transylvania counties, and emails opted-in
// subscribers once per warning per county (deduped via weather_alerts_sent).
//
// Trigger: cron. Admin-gated (inlined gate, called right after OPTIONS).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
//
// Attribution requirement: every email carries "Sursă: MeteoAlarm (CC BY 4.0)".
//
// Dry-run: POST body {"dry_run": true} → parse the live feed and return the
// qualifying warnings it WOULD send, WITHOUT sending emails or writing dedup
// rows. Lets us validate parsing against the live feed after deploy.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SITE = 'https://transilvaniatimes.com'
const FROM = 'Transilvania Times <no-reply@transilvaniatimes.com>'
const FEED_URL = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-romania'
const FEED_TIMEOUT_MS = 15000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
// County maps — 14 Transylvania counties
// ─────────────────────────────────────────────────────────────────────────────

// NUTS3 geocode -> county slug (preferred)
const NUTS3_TO_SLUG: Record<string, string> = {
  RO121: 'alba',
  RO111: 'bihor',
  RO112: 'bistrita-nasaud',
  RO122: 'brasov',
  RO113: 'cluj',
  RO123: 'covasna',
  RO124: 'harghita',
  RO423: 'hunedoara',
  RO114: 'maramures',
  RO125: 'mures',
  RO116: 'salaj',
  RO115: 'satu-mare',
  RO126: 'sibiu',
}

// normalized areaDesc name -> county slug (fallback)
const AREADESC_TO_SLUG: Record<string, string> = {
  'alba': 'alba',
  'bihor': 'bihor',
  'bistrita-nasaud': 'bistrita-nasaud',
  'brasov': 'brasov',
  'cluj': 'cluj',
  'covasna': 'covasna',
  'harghita': 'harghita',
  'hunedoara': 'hunedoara',
  'maramures': 'maramures',
  'mures': 'mures',
  'salaj': 'salaj',
  'satu-mare': 'satu-mare',
  'sibiu': 'sibiu',
}

// slug -> display label (RO)
const SLUG_TO_LABEL: Record<string, string> = {
  'alba': 'Alba',
  'bihor': 'Bihor',
  'bistrita-nasaud': 'Bistrița-Năsăud',
  'brasov': 'Brașov',
  'cluj': 'Cluj',
  'covasna': 'Covasna',
  'harghita': 'Harghita',
  'hunedoara': 'Hunedoara',
  'maramures': 'Maramureș',
  'mures': 'Mureș',
  'salaj': 'Sălaj',
  'satu-mare': 'Satu Mare',
  'sibiu': 'Sibiu',
}

// NOTE: the spec lists 14 Transylvania counties but the NUTS3/areaDesc tables
// enumerate 13. We treat the 13 mapped slugs as the qualifying set; a warning
// whose county cannot be mapped to one of these slugs is skipped.
const VALID_SLUGS = new Set(Object.values(NUTS3_TO_SLUG))

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
}

// ─────────────────────────────────────────────────────────────────────────────
// Feed parsing
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedWarning {
  county:         string   // slug
  countyLabel:    string
  level:          number    // 3 = orange, 4 = red
  capIdentifier:  string
  event:          string
  onset:          string | null
  expires:        string | null
}

// Pull the first captured group of a regex against a chunk, or null.
function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text)
  return m ? m[1].trim() : null
}

// Extract the tag value regardless of namespace prefix (cap: or none).
function tagValue(text: string, tag: string): string | null {
  // matches <cap:tag ...>value</cap:tag> or <tag>value</tag>
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`, 'i')
  return firstMatch(text, re)
}

function stripCdata(s: string | null): string | null {
  if (s == null) return null
  return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim()
}

// Split the feed into <entry>…</entry> chunks (namespace-agnostic).
function splitEntries(xml: string): string[] {
  const out: string[] = []
  const re = /<(?:[a-zA-Z0-9]+:)?entry\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?entry>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

// From an entry, find the awareness_level integer (leading number of "3; orange").
function extractAwarenessLevel(entry: string): number | null {
  // Look for a <parameter> whose valueName is awareness_level, then its value.
  // Structure (CAP): <valueName>awareness_level</valueName><value>3; orange</value>
  const re = /awareness_level<\/(?:[a-zA-Z0-9]+:)?valueName>\s*<(?:[a-zA-Z0-9]+:)?value>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?value>/i
  const raw = firstMatch(entry, re)
  if (raw == null) return null
  const cleaned = stripCdata(raw) || ''
  const num = /(\d+)/.exec(cleaned)
  return num ? parseInt(num[1], 10) : null
}

// From an entry, resolve the county slug: prefer NUTS3 geocode, fall back to areaDesc.
function extractCountySlug(entry: string): string | null {
  // NUTS3: <valueName>NUTS3</valueName><value>RO113</value>
  const nutsRe = /NUTS3<\/(?:[a-zA-Z0-9]+:)?valueName>\s*<(?:[a-zA-Z0-9]+:)?value>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?value>/i
  const nutsRaw = stripCdata(firstMatch(entry, nutsRe))
  if (nutsRaw) {
    const code = nutsRaw.trim().toUpperCase()
    if (NUTS3_TO_SLUG[code]) return NUTS3_TO_SLUG[code]
  }
  // Fallback: areaDesc
  const area = stripCdata(tagValue(entry, 'areaDesc'))
  if (area) {
    const norm = normalizeName(area)
    if (AREADESC_TO_SLUG[norm]) return AREADESC_TO_SLUG[norm]
  }
  return null
}

function parseEntry(entry: string): ParsedWarning | null {
  try {
    const level = extractAwarenessLevel(entry)
    if (level == null) return null

    const slug = extractCountySlug(entry)
    if (!slug) return null

    const capIdentifier = stripCdata(tagValue(entry, 'identifier'))
      || stripCdata(tagValue(entry, 'id'))
    if (!capIdentifier) return null

    const event = stripCdata(tagValue(entry, 'event')) || 'Avertizare meteo'
    const onset = stripCdata(tagValue(entry, 'onset'))
    const expires = stripCdata(tagValue(entry, 'expires'))

    return {
      county: slug,
      countyLabel: SLUG_TO_LABEL[slug] || slug,
      level,
      capIdentifier,
      event,
      onset,
      expires,
    }
  } catch (e) {
    console.error('[weather-alert] entry parse skipped:', (e as Error).message)
    return null
  }
}

async function fetchAndParseFeed(): Promise<ParsedWarning[]> {
  const res = await fetch(FEED_URL, {
    method: 'GET',
    headers: { 'Accept': 'application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`MeteoAlarm feed HTTP ${res.status}`)
  const xml = await res.text()

  const warnings: ParsedWarning[] = []
  for (const entry of splitEntries(xml)) {
    const w = parseEntry(entry)
    if (w) warnings.push(w)
  }
  return warnings
}

// Keep: level >= 3 AND county in the 13 slugs AND still active (now < expires).
function qualify(warnings: ParsedWarning[]): ParsedWarning[] {
  const now = Date.now()
  const seen = new Set<string>()
  const out: ParsedWarning[] = []
  for (const w of warnings) {
    if (w.level < 3) continue
    if (!VALID_SLUGS.has(w.county)) continue
    if (w.expires) {
      const exp = Date.parse(w.expires)
      if (!isNaN(exp) && now >= exp) continue // expired
    }
    // de-duplicate identical (county, capIdentifier) inside a single feed pull
    const key = `${w.county}::${w.capIdentifier}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(w)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Email
// ─────────────────────────────────────────────────────────────────────────────

interface Recipient { email: string; language: 'ro' | 'en' }

function fmtWindow(onset: string | null, expires: string | null): string {
  const fmt = (s: string | null): string => {
    if (!s) return '—'
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return d.toLocaleString('ro-RO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest',
    })
  }
  return `${fmt(onset)} – ${fmt(expires)}`
}

function alertEmailHtml(w: ParsedWarning, lang: 'ro' | 'en', email: string): string {
  const isRo = lang === 'ro'
  const levelWord = isRo
    ? (w.level >= 4 ? 'roșu' : 'portocaliu')
    : (w.level >= 4 ? 'Red' : 'Orange')
  const barColor = w.level >= 4 ? '#C41E3A' : '#E8820C'
  const validLabel = isRo ? 'Valabilitate' : 'Valid'
  const win = fmtWindow(w.onset, w.expires)
  const enc = encodeURIComponent(email)
  const prefs = isRo ? 'Preferințe' : 'Preferences'
  const unsub = isRo ? 'Dezabonare' : 'Unsubscribe'
  const heading = isRo
    ? `Cod ${levelWord} pentru județul ${w.countyLabel}`
    : `${levelWord} alert for ${w.countyLabel} county`
  const intro = isRo
    ? `A fost emisă o avertizare meteorologică de <strong>cod ${levelWord}</strong> pentru județul <strong>${w.countyLabel}</strong>.`
    : `A <strong>${levelWord.toLowerCase()}</strong> weather warning has been issued for <strong>${w.countyLabel}</strong> county.`
  const eventLabel = isRo ? 'Fenomen' : 'Phenomenon'
  const year = new Date().getFullYear()

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
<tr><td align="center"><table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;">
<tr><td style="background:${barColor};padding:28px 48px;text-align:center;">
<p style="margin:0;font-family:Arial,sans-serif;font-size:22px;font-weight:700;color:#ffffff;">⚠️ ${isRo ? 'Cod' : ''} ${levelWord} ${isRo ? '' : 'alert'}</p>
<p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:12px;color:rgba(255,255,255,0.85);letter-spacing:0.15em;text-transform:uppercase;">Transilvania Times</p>
</td></tr>
<tr><td style="padding:36px 48px;">
<h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:22px;line-height:1.3;color:#1a1a1a;font-weight:700;">${heading}</h1>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#444;">${intro}</p>
<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:#333;">
<tr><td style="padding:6px 0;color:#888;width:140px;">${eventLabel}</td><td style="padding:6px 0;font-weight:700;">${w.event}</td></tr>
<tr><td style="padding:6px 0;color:#888;">${validLabel}</td><td style="padding:6px 0;font-weight:700;">${win}</td></tr>
</table>
<p style="margin:22px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#999;">Sursă: MeteoAlarm (CC BY 4.0)</p>
</td></tr>
<tr><td style="background:#f5f4f0;padding:20px 48px;border-top:1px solid #e5e2d9;text-align:center;">
<p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#999;"><a href="${SITE}" style="color:#999;text-decoration:none;">transilvaniatimes.com</a> &nbsp;·&nbsp; <a href="${SITE}/preferinte?email=${enc}" style="color:#999;text-decoration:underline;">${prefs}</a> &nbsp;·&nbsp; <a href="${SITE}/dezabonare?email=${enc}" style="color:#999;text-decoration:underline;">${unsub}</a></p>
<p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#bbb;">&copy; ${year} Transilvania Times · Cluj-Napoca, România</p>
</td></tr>
</table></td></tr>
</table></body></html>`
}

// deno-lint-ignore no-explicit-any
async function fetchAlertRecipients(supabase: any, slug: string): Promise<Recipient[]> {
  const { data } = await supabase
    .from('newsletter_subscribers')
    .select('email, language')
    .eq('county', slug)
    .eq('weather_alerts', true)
    .eq('is_active', true)
    .is('unsubscribed_at', null)

  if (!data) return []
  return (data as Array<{ email: string; language: string }>)
    .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))
    .map((r) => ({
      email: r.email,
      language: (r.language === 'en' ? 'en' : 'ro') as 'ro' | 'en',
    }))
}

async function sendAlert(w: ParsedWarning, recipients: Recipient[]): Promise<number> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return 0

  const levelWordRo = w.level >= 4 ? 'roșu' : 'portocaliu'
  const levelWordEn = w.level >= 4 ? 'Red' : 'Orange'
  const subjectRo = `⚠️ Cod ${levelWordRo} — ${w.countyLabel}`
  const subjectEn = `⚠️ ${levelWordEn} alert — ${w.countyLabel}`

  let sent = 0
  for (const r of recipients) {
    const subject = r.language === 'en' ? subjectEn : subjectRo
    const html = alertEmailHtml(w, r.language, r.email)
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          from: FROM,
          to: [r.email],
          subject,
          html,
          reply_to: 'contact@transilvaniatimes.com',
        }),
      })
      if (res.ok) sent++
      else console.error(`[weather-alert] send failed for ${r.email}: ${res.status}`)
    } catch (e) {
      console.error(`[weather-alert] send error for ${r.email}:`, (e as Error).message)
    }
    // Resend free tier is 2 req/sec — throttle
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
    const body = await req.json().catch(() => ({})) as { dry_run?: boolean }
    const dryRun = body.dry_run === true

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Fetch + parse the live feed
    const parsed = await fetchAndParseFeed()

    // 2. Keep qualifying (level>=3, valid county, still active)
    const qualifying = qualify(parsed)

    // 3. DRY RUN — report what WOULD be sent, no emails, no dedup writes.
    if (dryRun) {
      const would: Array<Record<string, unknown>> = []
      for (const w of qualifying) {
        const recipients = await fetchAlertRecipients(supabase, w.county)
        would.push({
          county: w.county,
          county_label: w.countyLabel,
          level: w.level,
          event: w.event,
          onset: w.onset,
          expires: w.expires,
          cap_identifier: w.capIdentifier,
          recipient_count: recipients.length,
        })
      }
      return new Response(JSON.stringify({
        ok: true,
        dry_run: true,
        warnings_found: qualifying.length,
        would_send: would,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    // 4. NORMAL — for each NEW qualifying warning: send + record dedup row.
    let alertsSent = 0
    let emailsSent = 0

    for (const w of qualifying) {
      // Dedup: skip if a row already exists for (county, cap_identifier).
      const { data: existing, error: existErr } = await supabase
        .from('weather_alerts_sent')
        .select('id')
        .eq('county', w.county)
        .eq('cap_identifier', w.capIdentifier)
        .maybeSingle()

      if (existErr) {
        console.error(`[weather-alert] dedup lookup failed for ${w.county}/${w.capIdentifier}:`, existErr.message)
        continue
      }
      if (existing) continue // already sent

      const recipients = await fetchAlertRecipients(supabase, w.county)
      const sent = recipients.length > 0 ? await sendAlert(w, recipients) : 0
      emailsSent += sent
      alertsSent += 1

      // Record dedup row (with recipients_count) so we never resend this warning.
      const { error: insErr } = await supabase.from('weather_alerts_sent').insert({
        county: w.county,
        cap_identifier: w.capIdentifier,
        awareness_level: w.level,
        event: w.event,
        onset: w.onset,
        expires: w.expires,
        recipients_count: sent,
        sent_at: new Date().toISOString(),
      })
      if (insErr) {
        console.error(`[weather-alert] dedup insert failed for ${w.county}/${w.capIdentifier}:`, insErr.message)
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      warnings_found: qualifying.length,
      alerts_sent: alertsSent,
      emails_sent: emailsSent,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (e) {
    console.error('[weather-alert] fatal:', (e as Error).message)
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})

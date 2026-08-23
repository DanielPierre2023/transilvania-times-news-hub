// supabase/functions/send-banner-pricing/index.ts
//
// =============================================================================
// SEND BANNER PRICING — v6 (May 29, 2026, NEW)
// =============================================================================
//
// SCOPE: The leaner counterpart to send-mediakit. The full mediakit
// (app/api/advertising/send-mediakit/route.ts) is a multi-section document
// with "About us," technical specifications, the full pricing table, the
// process, and the CTA. Some prospects ask only "what does a banner cost?" —
// they don't need the brochure. This function sends a short, focused
// pricing email.
//
// Triggered from app/admin/contacts/page.tsx via the per-contact
// "Send banner pricing" button.
//
// CALL SHAPE:
//   { recipientName: string, recipientEmail: string, language: 'ro' | 'en' }
//
// Deploy: verify_jwt=true. Admin-only (calling page enforces auth).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SITE = 'https://transilvaniatimes.com'
const FROM = 'Transilvania Times <no-reply@transilvaniatimes.com>'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PricingRow {
  slot:        string
  label_ro:    string
  label_en:    string
  format:      string
  weekly_eur:  number
  monthly_eur: number
  yearly_eur:  number
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML composer — uses the same red header layout as the welcome email
// ─────────────────────────────────────────────────────────────────────────────

function buildPricingHtml(name: string, lang: 'ro' | 'en', pricing: PricingRow[]): { subject: string; html: string } {
  const isRo = lang === 'ro'
  const t = {
    subject: isRo
      ? 'Transilvania Times — Tarife Publicitate 2026'
      : 'Transilvania Times — Advertising Rates 2026',
    preheader: isRo
      ? 'TARIFE PUBLICITATE · 2026'
      : 'ADVERTISING RATES · 2026',
    heading: isRo
      ? `Tarife publicitate ${new Date().getFullYear()}`
      : `Advertising rates ${new Date().getFullYear()}`,
    greeting: isRo ? `Stimate/Stimată ${name},` : `Dear ${name},`,
    intro: isRo
      ? 'Mai jos găsiți tarifele actuale pentru publicitatea pe Transilvania Times. Pentru kit-ul media complet (specificații, formate, procesul de rezervare), răspundeți acestui email și vi-l trimitem.'
      : 'Below are the current advertising rates for Transilvania Times. For the full media kit (specifications, formats, booking process), reply to this email and we will send it.',
    slotLabel: isRo ? 'Slot'   : 'Slot',
    format:    isRo ? 'Format' : 'Format',
    weekly:    isRo ? 'Săptămânal' : 'Weekly',
    monthly:   isRo ? 'Lunar'      : 'Monthly',
    yearly:    isRo ? 'Anual'      : 'Yearly',
    discountNote: isRo
      ? '* Tarifele anuale includ ~20% reducere față de tariful lunar × 12. Toate prețurile sunt în EUR și nu includ TVA.'
      : '* Annual rates include ~20% discount vs monthly × 12. All prices in EUR, VAT excluded.',
    closingNote: isRo
      ? 'Pentru rezervări sau pachete personalizate (mai multe sloturi, perioade lungi, exclusivitate), răspundeți acestui email și revin cu o ofertă specifică.'
      : 'For bookings or custom packages (multiple slots, long-term contracts, exclusivity), reply to this email and I will return with a specific quote.',
    closing: isRo ? 'Cu stimă,' : 'Best regards,',
    team:    isRo ? 'Echipa Transilvania Times' : 'The Transilvania Times Team',
    ctaText: isRo ? 'CONTACTAȚI-NE' : 'CONTACT US',
    privacy: isRo ? 'Politică de confidențialitate' : 'Privacy policy',
  }

  const rows = pricing.map((p) => {
    const lbl = isRo ? p.label_ro : p.label_en
    const w = p.weekly_eur  > 0 ? `€${p.weekly_eur}`  : '—'
    const m = p.monthly_eur > 0 ? `€${p.monthly_eur}` : '—'
    const y = p.yearly_eur  > 0 ? `€${p.yearly_eur}`  : '—'
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede6;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;font-weight:600;">${lbl}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede6;font-family:Arial,sans-serif;font-size:12px;color:#666;">${p.format}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede6;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;text-align:center;">${w}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede6;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;text-align:center;">${m}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede6;font-family:Arial,sans-serif;font-size:13px;color:#C41E3A;text-align:center;font-weight:700;">${y}</td>
    </tr>`
  }).join('')

  const year = new Date().getFullYear()
  const footerCopy = isRo
    ? `&copy; ${year} Transilvania Times · Cluj-Napoca, România`
    : `&copy; ${year} Transilvania Times · Cluj-Napoca, Romania`

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${t.subject}</title></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
<tr><td align="center"><table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;">

<tr><td style="background:#C41E3A;padding:36px 48px;text-align:center;border-bottom:4px solid #a01830;">
<p style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:700;font-style:italic;color:#ffffff;letter-spacing:-0.5px;">Transilvania Times</p>
<p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.75);letter-spacing:0.2em;text-transform:uppercase;">${t.preheader}</p>
</td></tr>

<tr><td style="padding:40px 48px;">
<h1 style="margin:0 0 22px;font-family:Georgia,serif;font-size:24px;line-height:1.3;color:#1a1a1a;font-weight:700;">${t.heading}</h1>

<p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#444;margin:0 0 8px;">${t.greeting}</p>
<p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#444;margin:0 0 24px;">${t.intro}</p>

<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid #e5e2d9;">
  <tr style="background:#C41E3A;">
    <th style="padding:12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#fff;text-align:left;">${t.slotLabel}</th>
    <th style="padding:12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#fff;text-align:left;">${t.format}</th>
    <th style="padding:12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#fff;text-align:center;">${t.weekly}</th>
    <th style="padding:12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#fff;text-align:center;">${t.monthly}</th>
    <th style="padding:12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#fff;text-align:center;">${t.yearly} *</th>
  </tr>
  ${rows}
</table>
<p style="font-family:Arial,sans-serif;font-size:11px;color:#999;font-style:italic;margin:0 0 28px;">${t.discountNote}</p>

<div style="background:#f5f4f0;border-left:3px solid #C41E3A;padding:14px 18px;margin:0 0 24px;">
  <p style="font-family:Arial,sans-serif;font-size:13px;line-height:1.65;color:#444;margin:0;font-style:italic;">${t.closingNote}</p>
</div>

<table cellpadding="0" cellspacing="0" align="center" style="margin:24px auto 24px;"><tr><td style="background:#C41E3A;"><a href="mailto:contact@transilvaniatimes.com" style="display:inline-block;padding:14px 36px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:0.1em;text-transform:uppercase;">${t.ctaText} →</a></td></tr></table>

<p style="font-family:Georgia,serif;font-size:15px;color:#1a1a1a;margin:0 0 4px;">${t.closing}</p>
<p style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#C41E3A;margin:0 0 2px;">${t.team}</p>
<p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin:4px 0 0;">
  <a href="mailto:contact@transilvaniatimes.com" style="color:#999;">contact@transilvaniatimes.com</a> &nbsp;·&nbsp;
  <a href="${SITE}" style="color:#999;">${SITE}</a>
</p>

</td></tr>

<tr><td style="background:#f5f4f0;padding:24px 48px;border-top:1px solid #e5e2d9;text-align:center;">
<p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#999;"><a href="${SITE}" style="color:#999;text-decoration:none;">transilvaniatimes.com</a> &nbsp;·&nbsp; <a href="${SITE}/politica-confidentialitate" style="color:#999;text-decoration:underline;">${t.privacy}</a></p>
<p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#bbb;">${footerCopy}</p>
</td></tr>

</table></td></tr>
</table></body></html>`

  return { subject: t.subject, html }
}

// ─────────────────────────────────────────────────────────────────────────────
// Serve
// ─────────────────────────────────────────────────────────────────────────────

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
      recipientName?:  string
      recipientEmail?: string
      language?:       'ro' | 'en'
      contact_id?:     string
    }

    const name  = (body.recipientName  || '').trim()
    const email = (body.recipientEmail || '').trim().toLowerCase()
    const lang  = (body.language === 'en' ? 'en' : 'ro') as 'ro' | 'en'

    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: 'Valid name and email required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: pricing, error: pErr } = await supabase
      .from('ad_pricing')
      .select('slot, label_ro, label_en, format, weekly_eur, monthly_eur, yearly_eur')
      .order('yearly_eur', { ascending: false })

    if (pErr || !pricing || pricing.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Pricing not configured' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const { subject, html } = buildPricingHtml(name, lang, pricing as PricingRow[])

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      return new Response(JSON.stringify({ ok: false, error: 'RESEND_API_KEY not configured' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject,
        html,
        reply_to: 'contact@transilvaniatimes.com',
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return new Response(JSON.stringify({ ok: false, error: `Resend ${res.status}: ${errText.substring(0, 200)}` }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Log + update contact last_email_sent_at
    await supabase.from('ad_inquiries').insert({
      recipient_name:  name,
      recipient_email: email,
      language:        lang,
      slots_offered:   'banner_pricing_only',
    })

    if (body.contact_id) {
      await supabase.from('contacts').update({
        last_email_sent_at: new Date().toISOString(),
        last_email_type:    'banner_pricing',
      }).eq('id', body.contact_id)
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
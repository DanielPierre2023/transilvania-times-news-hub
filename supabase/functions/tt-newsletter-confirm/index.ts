// supabase/functions/tt-newsletter-confirm/index.ts
//
// =============================================================================
// NEWSLETTER CONFIRMATION + WELCOME — v6 (May 29, 2026)
// =============================================================================
//
// REPLACES: confirm-newsletter (which was a misnamed welcome-mailer, no
//           actual token verification step).
//
// FLOW:
//   1. User submits email on /newsletter or footer signup.
//   2. /api/newsletter/subscribe creates a newsletter_subscribers row with
//      confirmed=false and confirmation_token=<uuid>, then calls THIS
//      function with action='send_confirm'.
//   3. THIS function sends a "confirm your subscription" email with a link
//      to https://transilvaniatimes.com/newsletter/confirm?token=<uuid>
//   4. The /newsletter/confirm page calls THIS function again with
//      action='verify' and the token. This function:
//        - sets confirmed=true, confirmed_at=now()
//        - clears the token
//        - sends the WELCOME email (the design from Daniel's screenshot)
//   5. THIS function also handles action='resend' for the admin "resend
//      confirmation" button on the subscribers page.
//
// SELF-CONTAINED: brandedEmailV2 template inlined verbatim.
// Deploy: verify_jwt=FALSE (public, called by anon user on /newsletter/confirm).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SITE = 'https://transilvaniatimes.com'
const FROM = 'Transilvania Times <no-reply@transilvaniatimes.com>'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─────────────────────────────────────────────────────────────────────────────
// BRANDED EMAIL TEMPLATE — inlined (MCP can't share _shared/)
// ─────────────────────────────────────────────────────────────────────────────

interface EmailBullet { label: string; detail?: string }
interface EmailCta    { label: string; url: string }
interface BrandedEmailV2Opts {
  lang:         'ro' | 'en'
  preheaderRo?: string
  preheaderEn?: string
  heading:      string
  bodyHtml:     string
  bullets?:     EmailBullet[]
  quote?:       string
  cta?:         EmailCta
  footerExtra?: string
}

function brandedEmailV2(opts: BrandedEmailV2Opts): string {
  const isRo = opts.lang === 'ro'
  const year = new Date().getFullYear()
  const preheader = isRo
    ? (opts.preheaderRo || 'ȘTIRI INDEPENDENTE DIN INIMA TRANSILVANIEI')
    : (opts.preheaderEn || 'INDEPENDENT NEWS FROM TRANSYLVANIA')
  const footerCopy = isRo
    ? `&copy; ${year} Transilvania Times · Cluj-Napoca, România`
    : `&copy; ${year} Transilvania Times · Cluj-Napoca, Romania`
  const privacy = isRo ? 'Politică de confidențialitate' : 'Privacy policy'

  const bulletsBlock = (opts.bullets && opts.bullets.length > 0)
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">${opts.bullets.map((b) => `<tr>
  <td style="width:20px;padding:6px 0;vertical-align:top;color:#C41E3A;font-family:Arial,sans-serif;font-size:14px;font-weight:700;">►</td>
  <td style="padding:6px 0 6px 6px;font-family:Arial,sans-serif;font-size:14px;line-height:1.65;color:#333;border-bottom:1px solid #f0ede6;">
    <strong style="color:#1a1a1a;">${b.label}</strong>${b.detail ? ` — <span style="color:#555;">${b.detail}</span>` : ''}
  </td>
</tr>`).join('')}</table>` : ''

  const quoteBlock = opts.quote
    ? `<div style="margin:24px 0;padding:14px 18px;background:#f5f4f0;border-left:3px solid #C41E3A;font-family:Georgia,serif;font-size:14px;font-style:italic;color:#555;line-height:1.65;">${opts.quote}</div>`
    : ''

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
<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#444;">${opts.bodyHtml}</div>
${bulletsBlock}${quoteBlock}${ctaBlock}
</td></tr>
<tr><td style="background:#f5f4f0;padding:24px 48px;border-top:1px solid #e5e2d9;text-align:center;">
${opts.footerExtra ? `<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:12px;color:#888;line-height:1.6;">${opts.footerExtra}</p>` : ''}
<p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#999;"><a href="${SITE}" style="color:#999;text-decoration:none;">transilvaniatimes.com</a> &nbsp;·&nbsp; <a href="${SITE}/politica-confidentialitate" style="color:#999;text-decoration:underline;">${privacy}</a></p>
<p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#bbb;">${footerCopy}</p>
</td></tr>
</table></td></tr>
</table></body></html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// Email senders
// ─────────────────────────────────────────────────────────────────────────────

async function sendResendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      html,
      reply_to: 'contact@transilvaniatimes.com',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return { ok: false, error: `Resend ${res.status}: ${err.substring(0, 200)}` }
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Email content builders
// ─────────────────────────────────────────────────────────────────────────────

function buildConfirmationEmail(lang: 'ro' | 'en', token: string): { subject: string; html: string } {
  const confirmUrl = `${SITE}/newsletter/confirm?token=${encodeURIComponent(token)}`
  if (lang === 'ro') {
    return {
      subject: 'Confirmă-ți abonarea la Transilvania Times',
      html: brandedEmailV2({
        lang: 'ro',
        heading: 'Mai e un pas — confirmă-ți abonarea',
        bodyHtml: `
          <p>Bună,</p>
          <p>Ai cerut să te abonezi la newsletter-ul <strong>Transilvania Times</strong>. Mai e un singur pas: dă click pe butonul de mai jos ca să confirmi că adresa de email îți aparține.</p>
          <p>Link-ul de confirmare e valabil <strong>48 de ore</strong>. Dacă nu tu ai cerut abonarea, ignoră acest mesaj — nu vei fi adăugat la nicio listă.</p>
        `,
        cta: { label: 'CONFIRMĂ ABONAREA', url: confirmUrl },
        quote: 'Nu trimitem niciodată mesaje fără permisiune. Confirmarea garantează asta.',
        footerExtra: 'Dacă butonul nu funcționează, copiază acest link în browser:<br/>' + confirmUrl,
      }),
    }
  }
  return {
    subject: 'Confirm your Transilvania Times subscription',
    html: brandedEmailV2({
      lang: 'en',
      heading: 'One more step — please confirm',
      bodyHtml: `
        <p>Hello,</p>
        <p>You requested to subscribe to the <strong>Transilvania Times</strong> newsletter. One step left: click the button below to confirm this email belongs to you.</p>
        <p>The confirmation link is valid for <strong>48 hours</strong>. If you did not request this, simply ignore this email — you will not be added to any list.</p>
      `,
      cta: { label: 'CONFIRM SUBSCRIPTION', url: confirmUrl },
      quote: 'We never send messages without permission. Confirmation guarantees that.',
      footerExtra: "If the button doesn't work, copy this link to your browser:<br/>" + confirmUrl,
    }),
  }
}

function buildWelcomeEmail(lang: 'ro' | 'en'): { subject: string; html: string } {
  if (lang === 'ro') {
    return {
      subject: 'Bine ai venit la Transilvania Times! 📰',
      html: brandedEmailV2({
        lang: 'ro',
        heading: 'Bun venit în comunitatea noastră!',
        bodyHtml: `
          <p>Mulțumim că te-ai abonat la <strong>Transilvania Times</strong>. Ești acum parte din comunitatea noastră de cititori care urmăresc cele mai importante știri din Transilvania și din România.</p>
          <p><strong>Ce vei primi de la noi:</strong></p>
        `,
        bullets: [
          { label: 'Digest săptămânal',        detail: 'cele mai importante știri regionale și naționale, selecționate de redacția noastră' },
          { label: 'Analize și investigații',  detail: 'jurnalism independent, fără influențe politice sau comerciale' },
          { label: 'Cultură și comunitate',    detail: 'evenimente, oameni și povești din inima Transilvaniei' },
        ],
        quote: 'Trimitem conținut selectat o dată pe săptămână — fără spam, garantat.',
        cta: { label: 'VIZITEAZĂ TRANSILVANIA TIMES', url: SITE },
      }),
    }
  }
  return {
    subject: 'Welcome to Transilvania Times! 📰',
    html: brandedEmailV2({
      lang: 'en',
      heading: 'Welcome to our community!',
      bodyHtml: `
        <p>Thank you for subscribing to <strong>Transilvania Times</strong>. You are now part of our community of readers following the most important news from Transylvania and Romania.</p>
        <p><strong>What you will receive:</strong></p>
      `,
      bullets: [
        { label: 'Weekly digest',           detail: 'the most important regional and national stories, curated by our editorial team' },
        { label: 'Analysis and reporting',  detail: 'independent journalism, free from political or commercial influence' },
        { label: 'Culture and community',   detail: 'events, people, and stories from the heart of Transylvania' },
      ],
      quote: 'We send curated content once a week — no spam, guaranteed.',
      cta: { label: 'VISIT TRANSILVANIA TIMES', url: SITE },
    }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Serve
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const body = await req.json().catch(() => ({})) as {
      action?: 'send_confirm' | 'verify' | 'resend'
      email?:  string
      token?:  string
      lang?:   'ro' | 'en'
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const action = body.action || 'send_confirm'

    // ─── Action: send the initial confirmation email ───────────────────────
    if (action === 'send_confirm' || action === 'resend') {
      const email = (body.email || '').trim().toLowerCase()
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response(JSON.stringify({ ok: false, error: 'Invalid email' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      const { data: sub, error: subErr } = await supabase
        .from('newsletter_subscribers')
        .select('id, language, confirmed, confirmation_token, confirmation_sent_at')
        .eq('email', email)
        .maybeSingle()

      if (subErr || !sub) {
        return new Response(JSON.stringify({ ok: false, error: 'Subscriber not found. Subscribe first.' }), {
          status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }
      const subscriber = sub as { id: string; language: string; confirmed: boolean; confirmation_token: string | null }

      if (subscriber.confirmed) {
        return new Response(JSON.stringify({ ok: true, already_confirmed: true }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      const lang = ((body.lang || subscriber.language || 'ro') === 'en' ? 'en' : 'ro') as 'ro' | 'en'
      const token = crypto.randomUUID()

      await supabase
        .from('newsletter_subscribers')
        .update({
          confirmation_token:   token,
          confirmation_sent_at: new Date().toISOString(),
          language:             lang,
        })
        .eq('id', subscriber.id)

      const { subject, html } = buildConfirmationEmail(lang, token)
      const sendResult = await sendResendEmail(email, subject, html)
      if (!sendResult.ok) {
        return new Response(JSON.stringify({ ok: false, error: sendResult.error }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ ok: true, action: 'confirmation_sent' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // ─── Action: verify token and send welcome ────────────────────────────
    if (action === 'verify') {
      const token = body.token || ''
      if (!token) {
        return new Response(JSON.stringify({ ok: false, error: 'Token required' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      const { data: sub } = await supabase
        .from('newsletter_subscribers')
        .select('id, email, language, confirmed, confirmation_sent_at')
        .eq('confirmation_token', token)
        .maybeSingle()

      if (!sub) {
        return new Response(JSON.stringify({ ok: false, error: 'Invalid or expired token' }), {
          status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }
      const subscriber = sub as { id: string; email: string; language: string; confirmed: boolean; confirmation_sent_at: string | null }

      // 48-hour validity window
      const sentAt = subscriber.confirmation_sent_at ? new Date(subscriber.confirmation_sent_at).getTime() : 0
      const ageHours = (Date.now() - sentAt) / 3600000
      if (ageHours > 48) {
        return new Response(JSON.stringify({ ok: false, error: 'Token expired. Subscribe again.' }), {
          status: 410, headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      if (subscriber.confirmed) {
        return new Response(JSON.stringify({ ok: true, already_confirmed: true, email: subscriber.email }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      await supabase
        .from('newsletter_subscribers')
        .update({
          confirmed:          true,
          confirmed_at:       new Date().toISOString(),
          confirmation_token: null,
          is_active:          true,
        })
        .eq('id', subscriber.id)

      const lang = (subscriber.language === 'en' ? 'en' : 'ro') as 'ro' | 'en'
      const { subject, html } = buildWelcomeEmail(lang)
      await sendResendEmail(subscriber.email, subject, html)

      return new Response(JSON.stringify({ ok: true, action: 'confirmed', email: subscriber.email }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: false, error: 'Unknown action' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
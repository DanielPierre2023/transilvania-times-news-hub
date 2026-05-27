import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SITE_URL = 'https://transilvaniatimes.com'
const FROM     = 'Transilvania Times <no-reply@transilvaniatimes.com>'

interface Pricing {
  slot: string
  label_ro: string
  label_en: string
  format: string
  weekly_eur: number
  monthly_eur: number
  yearly_eur: number
}

function mediaKitHtml(
  recipientName: string,
  lang: 'ro' | 'en',
  pricing: Pricing[]
): string {
  const isRo = lang === 'ro'

  const t = {
    subject:    isRo ? 'Oportunitate de publicitate' : 'Advertising Opportunity',
    greeting:   isRo ? `Stimate/Stimată ${recipientName},` : `Dear ${recipientName},`,
    intro1:     isRo
      ? 'Vă mulțumim pentru interesul acordat oportunităților de publicitate pe <strong>Transilvania Times</strong> — prima platformă de știri independente dedicată comunității din Transilvania și din România.'
      : 'Thank you for your interest in advertising opportunities on <strong>Transilvania Times</strong> — the leading independent news platform dedicated to the Transylvanian and Romanian community.',
    intro2:     isRo
      ? 'Vă prezentăm mai jos Kit-ul nostru Media pentru 2026, cu informații complete despre formatul reclamelor, plasamentele disponibile și tarifele noastre.'
      : 'Please find below our 2026 Media Kit, with complete information about ad formats, available placements and our rates.',
    aboutTitle: isRo ? 'Despre Transilvania Times' : 'About Transilvania Times',
    about1:     isRo
      ? 'Transilvania Times este o publicație digitală independentă care acoperă știri regionale, politică, afaceri, cultură și sport din inima Transilvaniei. Conținutul nostru este disponibil bilingv (română și engleză), adresându-se atât publicului local cât și cititorilor internaționali.'
      : 'Transilvania Times is an independent digital publication covering regional news, politics, business, culture and sport from the heart of Transylvania. Our content is available bilingually (Romanian and English), reaching both local and international audiences.',
    about2:     isRo
      ? 'Platforma noastră utilizează tehnologie AI de ultimă generație pentru redacția editorială, oferind conținut de înaltă calitate 24/7.'
      : 'Our platform uses cutting-edge AI technology for editorial production, delivering high-quality content 24/7.',
    specsTitle: isRo ? 'Specificații tehnice' : 'Technical Specifications',
    specsIntro: isRo
      ? 'Acceptăm bannere în formatele standard IAB. Fișierele trebuie furnizate în format JPG, PNG sau WebP, la rezoluție 2× (retina). Zona de siguranță recomandată: 20px de la margini.'
      : 'We accept banners in standard IAB formats. Files must be provided in JPG, PNG or WebP format, at 2× (retina) resolution. Recommended safe zone: 20px from edges.',
    pricingTitle: isRo ? 'Tarife Publicitate 2026' : 'Advertising Rates 2026',
    slotLabel:  isRo ? 'Slot / Plasament' : 'Slot / Placement',
    format:     isRo ? 'Format' : 'Format',
    weekly:     isRo ? 'Săptămânal' : 'Weekly',
    monthly:    isRo ? 'Lunar' : 'Monthly',
    yearly:     isRo ? 'Anual' : 'Yearly',
    discountNote: isRo
      ? '* Tarifele anuale includ o reducere de aproximativ 20% față de tariful lunar × 12. Toate prețurile sunt exprimate în EUR și nu includ TVA.'
      : '* Annual rates include approximately 20% discount vs monthly rate × 12. All prices are in EUR and exclude VAT.',
    processTitle: isRo ? 'Cum funcționează' : 'How it works',
    steps: isRo ? [
      'Contactați-ne la <a href="mailto:contact@transilvaniatimes.com" style="color:#C41E3A;">contact@transilvaniatimes.com</a> cu materialul publicitar și perioada dorită.',
      'Trimiteți fișierele banner în formatele specificate mai sus.',
      'Campania dvs. devine activă în 24 de ore lucrătoare de la confirmarea plății.',
      'Primiți rapoarte lunare de performanță (impresii și click-uri).',
    ] : [
      'Contact us at <a href="mailto:contact@transilvaniatimes.com" style="color:#C41E3A;">contact@transilvaniatimes.com</a> with your advertising material and desired period.',
      'Send banner files in the formats specified above.',
      'Your campaign goes live within 24 business hours of payment confirmation.',
      'Receive monthly performance reports (impressions and clicks).',
    ],
    ctaText:    isRo ? 'Rezervați spațiul publicitar' : 'Book your ad space',
    footerNote: isRo
      ? 'Pentru informații suplimentare sau oferte personalizate, nu ezitați să ne contactați. Suntem deschiși negocierii pentru campanii pe termen lung sau pachete multiple.'
      : 'For additional information or customised offers, please do not hesitate to contact us. We are open to negotiation for long-term campaigns or multiple slot packages.',
    closing: isRo ? 'Cu stimă,' : 'Best regards,',
    team:    isRo ? 'Echipa Transilvania Times' : 'The Transilvania Times Team',
  }

  const pricingRows = pricing.map(p => {
    const label = isRo ? p.label_ro : p.label_en
    const weekly = p.weekly_eur > 0 ? `€${p.weekly_eur}` : '—'
    const monthly = p.monthly_eur > 0 ? `€${p.monthly_eur}` : '—'
    const yearly = p.yearly_eur > 0 ? `€${p.yearly_eur}` : '—'
    return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede6;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;font-weight:600;">${label}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede6;font-family:Arial,sans-serif;font-size:12px;color:#666;">${p.format}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede6;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;text-align:center;">${weekly}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede6;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;text-align:center;">${monthly}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede6;font-family:Arial,sans-serif;font-size:13px;color:#C41E3A;text-align:center;font-weight:700;">${yearly}</td>
    </tr>`
  }).join('')

  const stepsHtml = t.steps.map((step, i) => `
    <tr>
      <td style="padding:8px 0;vertical-align:top;">
        <div style="width:24px;height:24px;background:#C41E3A;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-align:center;line-height:24px;flex-shrink:0;">${i + 1}</div>
      </td>
      <td style="padding:8px 0 8px 12px;font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.6;" colspan="4">${step}</td>
    </tr>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Transilvania Times — Media Kit 2026</title></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
  <tr><td align="center">
  <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;">

    <!-- Header -->
    <tr><td style="background:#C41E3A;padding:36px 48px;text-align:center;border-bottom:4px solid #a01830;">
      <p style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:700;font-style:italic;color:#fff;letter-spacing:-0.5px;">Transilvania Times</p>
      <p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:0.2em;text-transform:uppercase;">Media Kit 2026</p>
    </td></tr>

    <!-- Red band -->
    <tr><td style="background:#1a1a1a;padding:10px 48px;text-align:center;">
      <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:0.15em;text-transform:uppercase;">
        ${isRo ? 'Oportunități de publicitate · Tarife 2026' : 'Advertising Opportunities · 2026 Rates'}
      </p>
    </td></tr>

    <!-- Body -->
    <tr><td style="padding:40px 48px;">

      <!-- Greeting -->
      <p style="font-family:Georgia,serif;font-size:16px;color:#1a1a1a;margin:0 0 8px;">${t.greeting}</p>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.7;margin:0 0 16px;">${t.intro1}</p>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.7;margin:0 0 32px;">${t.intro2}</p>

      <!-- Divider -->
      <hr style="border:none;border-top:2px solid #C41E3A;margin:0 0 32px;">

      <!-- About -->
      <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 16px;">${t.aboutTitle}</h2>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.7;margin:0 0 12px;">${t.about1}</p>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.7;margin:0 0 32px;">${t.about2}</p>

      <!-- Tech specs -->
      <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 16px;">${t.specsTitle}</h2>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.7;margin:0 0 24px;">${t.specsIntro}</p>

      <!-- Spec table -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;border:1px solid #e5e2d9;">
        <tr style="background:#f5f4f0;">
          <th style="padding:10px 12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#666;text-align:left;">${isRo ? 'Slot' : 'Slot'}</th>
          <th style="padding:10px 12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#666;text-align:left;">${isRo ? 'Dimensiuni' : 'Dimensions'}</th>
          <th style="padding:10px 12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#666;text-align:left;">${isRo ? 'Plasament' : 'Placement'}</th>
        </tr>
        <tr><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;border-top:1px solid #e5e2d9;">Sidebar Homepage</td><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#666;border-top:1px solid #e5e2d9;">300×250 px</td><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:12px;color:#666;border-top:1px solid #e5e2d9;">${isRo ? 'Coloana dreaptă, pagina principală' : 'Right column, homepage'}</td></tr>
        <tr><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;border-top:1px solid #e5e2d9;">Sidebar Article</td><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#666;border-top:1px solid #e5e2d9;">300×600 px</td><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:12px;color:#666;border-top:1px solid #e5e2d9;">${isRo ? 'Lateral articol, vizibilitate maximă' : 'Article sidebar, maximum visibility'}</td></tr>
        <tr><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;border-top:1px solid #e5e2d9;">Leaderboard Category</td><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#666;border-top:1px solid #e5e2d9;">728×90 px</td><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:12px;color:#666;border-top:1px solid #e5e2d9;">${isRo ? 'Deasupra listei de articole pe categorii' : 'Above article list on category pages'}</td></tr>
        <tr><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;border-top:1px solid #e5e2d9;">In-feed Homepage</td><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#666;border-top:1px solid #e5e2d9;">600×300 px</td><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:12px;color:#666;border-top:1px solid #e5e2d9;">${isRo ? 'Integrat în fluxul de știri, pagina principală' : 'Integrated in news feed, homepage'}</td></tr>
        <tr><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;border-top:1px solid #e5e2d9;">Advertorial</td><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#666;border-top:1px solid #e5e2d9;">${isRo ? 'Articol complet' : 'Full article'}</td><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:12px;color:#666;border-top:1px solid #e5e2d9;">${isRo ? 'Articol sponsorizat publicat pe site' : 'Sponsored article published on site'}</td></tr>
      </table>

      <!-- Pricing -->
      <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 16px;">${t.pricingTitle}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid #e5e2d9;">
        <tr style="background:#C41E3A;">
          <th style="padding:12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#fff;text-align:left;">${t.slotLabel}</th>
          <th style="padding:12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#fff;text-align:left;">${t.format}</th>
          <th style="padding:12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#fff;text-align:center;">${t.weekly}</th>
          <th style="padding:12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#fff;text-align:center;">${t.monthly}</th>
          <th style="padding:12px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#fff;text-align:center;">${t.yearly} *</th>
        </tr>
        ${pricingRows}
      </table>
      <p style="font-family:Arial,sans-serif;font-size:11px;color:#999;font-style:italic;margin:0 0 32px;">${t.discountNote}</p>

      <!-- Process -->
      <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 16px;">${t.processTitle}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;">${stepsHtml}</table>

      <!-- Footer note -->
      <div style="background:#f5f4f0;border-left:3px solid #C41E3A;padding:16px 20px;margin:0 0 32px;">
        <p style="font-family:Arial,sans-serif;font-size:13px;color:#444;line-height:1.7;margin:0;font-style:italic;">${t.footerNote}</p>
      </div>

      <!-- CTA -->
      <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
        <tr><td style="background:#C41E3A;">
          <a href="mailto:contact@transilvaniatimes.com" style="display:inline-block;padding:16px 40px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:0.1em;text-transform:uppercase;">
            ${t.ctaText} →
          </a>
        </td></tr>
      </table>

      <!-- Closing -->
      <p style="font-family:Georgia,serif;font-size:15px;color:#1a1a1a;margin:0 0 4px;">${t.closing}</p>
      <p style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#C41E3A;margin:0;">${t.team}</p>
      <p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin:4px 0 0;">
        <a href="mailto:contact@transilvaniatimes.com" style="color:#999;"">contact@transilvaniatimes.com</a>
        &nbsp;·&nbsp;
        <a href="${SITE_URL}" style="color:#999;">${SITE_URL}</a>
      </p>

    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#f5f4f0;padding:24px 48px;border-top:1px solid #e5e2d9;text-align:center;">
      <p style="font-family:Arial,sans-serif;font-size:11px;color:#bbb;margin:0;">
        &copy; ${new Date().getFullYear()} Transilvania Times &mdash; Transilvania Times
        &nbsp;·&nbsp;
        <a href="${SITE_URL}" style="color:#bbb;">${SITE_URL}</a>
      </p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`
}

export async function POST(req: NextRequest) {
  try {
    const { recipientName, recipientEmail, language = 'ro', slotsOffered } = await req.json()

    if (!recipientName?.trim() || !recipientEmail?.trim()) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(recipientEmail)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    const lang: 'ro' | 'en' = language === 'en' ? 'en' : 'ro'

    // Use service role to read pricing
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data: pricing } = await supabase
      .from('ad_pricing')
      .select('slot, label_ro, label_en, format, weekly_eur, monthly_eur, yearly_eur')
      .order('yearly_eur', { ascending: false })

    if (!pricing || pricing.length === 0) {
      return NextResponse.json({ error: 'Could not load pricing' }, { status: 500 })
    }

    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey) {
      return NextResponse.json({ error: 'Email service not configured' }, { status: 500 })
    }

    const subject = lang === 'en'
      ? 'Transilvania Times — Media Kit & Advertising Rates 2026'
      : 'Transilvania Times — Media Kit & Tarife Publicitate 2026'

    const html = mediaKitHtml(recipientName.trim(), lang, pricing)

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: FROM,
        to: recipientEmail.trim().toLowerCase(),
        subject,
        html,
      }),
    })

    if (!resendRes.ok) {
      const err = await resendRes.text()
      console.error('[mediakit] Resend error:', err)
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    // Log inquiry
    await supabase.from('ad_inquiries').insert({
      recipient_name:  recipientName.trim(),
      recipient_email: recipientEmail.trim().toLowerCase(),
      language: lang,
      slots_offered: slotsOffered || 'all',
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[mediakit] Fatal:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

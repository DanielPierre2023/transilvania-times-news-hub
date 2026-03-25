import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SITE_URL = 'https://transilvaniatimes.com'
const FROM     = 'Transilvania Times <no-reply@transilvaniatimes.com>'

function welcomeEmailRo(email: string): string {
  return `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bun venit la Transilvania Times</title>
</head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">

      <!-- Header -->
      <tr>
        <td style="background:#C41E3A;padding:32px 40px;text-align:center;border-bottom:4px solid #a01830;">
          <p style="margin:0;font-family:Georgia,serif;font-size:32px;font-weight:bold;font-style:italic;color:#ffffff;letter-spacing:-0.5px;">
            Transilvania Times
          </p>
          <p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.75);letter-spacing:0.2em;text-transform:uppercase;">
            Știri independente din inima Transilvaniei
          </p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:40px 40px 32px;">
          <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:26px;font-weight:bold;color:#1a1a1a;line-height:1.3;">
            Bun venit în comunitatea noastră!
          </h1>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#444;line-height:1.7;">
            Mulțumim că te-ai abonat la <strong>Transilvania Times</strong>. Ești acum parte din comunitatea noastră de cititori care urmăresc cele mai importante știri din Transilvania și din România.
          </p>
          <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:15px;color:#444;line-height:1.7;">
            <strong style="color:#1a1a1a;">Ce vei primi de la noi:</strong>
          </p>

          <!-- Benefits -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #f0ede6;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:24px;vertical-align:top;padding-top:2px;">
                      <span style="color:#C41E3A;font-size:16px;">▸</span>
                    </td>
                    <td style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.6;padding-left:8px;">
                      <strong style="color:#1a1a1a;">Digest săptămânal</strong> — cele mai importante știri regionale și naționale, selecționate de redacția noastră
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #f0ede6;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:24px;vertical-align:top;padding-top:2px;">
                      <span style="color:#C41E3A;font-size:16px;">▸</span>
                    </td>
                    <td style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.6;padding-left:8px;">
                      <strong style="color:#1a1a1a;">Analize și investigații</strong> — jurnalism independent, fără influențe politice sau comerciale
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:24px;vertical-align:top;padding-top:2px;">
                      <span style="color:#C41E3A;font-size:16px;">▸</span>
                    </td>
                    <td style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.6;padding-left:8px;">
                      <strong style="color:#1a1a1a;">Cultură și comunitate</strong> — evenimente, oameni și povești din inima Transilvaniei
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 32px;font-family:Arial,sans-serif;font-size:14px;color:#666;line-height:1.7;font-style:italic;border-left:3px solid #C41E3A;padding-left:16px;">
            Trimitem conținut selectat o dată pe săptămână — fără spam, garantat.
          </p>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr>
              <td align="center" style="background:#C41E3A;">
                <a href="${SITE_URL}" style="display:inline-block;padding:14px 36px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#ffffff;text-decoration:none;letter-spacing:0.1em;text-transform:uppercase;">
                  Vizitează Transilvania Times →
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f5f4f0;padding:24px 40px;border-top:1px solid #e5e2d9;">
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:12px;color:#999;line-height:1.6;text-align:center;">
            Primești acest email deoarece te-ai abonat la <strong>Transilvania Times</strong>.
          </p>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#bbb;text-align:center;">
            <a href="${SITE_URL}/politica-confidentialitate" style="color:#999;text-decoration:underline;">Politică de confidențialitate</a>
            &nbsp;·&nbsp;
            <a href="${SITE_URL}" style="color:#999;text-decoration:underline;">transilvaniatimes.com</a>
            &nbsp;·&nbsp;
            ADD Individual Solutions Ltd.
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

function welcomeEmailEn(email: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to Transilvania Times</title>
</head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">

      <!-- Header -->
      <tr>
        <td style="background:#C41E3A;padding:32px 40px;text-align:center;border-bottom:4px solid #a01830;">
          <p style="margin:0;font-family:Georgia,serif;font-size:32px;font-weight:bold;font-style:italic;color:#ffffff;letter-spacing:-0.5px;">
            Transilvania Times
          </p>
          <p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.75);letter-spacing:0.2em;text-transform:uppercase;">
            Independent news from the heart of Transylvania
          </p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:40px 40px 32px;">
          <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:26px;font-weight:bold;color:#1a1a1a;line-height:1.3;">
            Welcome to our community!
          </h1>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#444;line-height:1.7;">
            Thank you for subscribing to <strong>Transilvania Times</strong>. You are now part of our community of readers following the most important news from Transylvania and Romania.
          </p>
          <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:15px;color:#444;line-height:1.7;">
            <strong style="color:#1a1a1a;">What you will receive from us:</strong>
          </p>

          <!-- Benefits -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #f0ede6;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:24px;vertical-align:top;padding-top:2px;">
                      <span style="color:#C41E3A;font-size:16px;">▸</span>
                    </td>
                    <td style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.6;padding-left:8px;">
                      <strong style="color:#1a1a1a;">Weekly digest</strong> — the most important regional and national news, curated by our editorial team
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #f0ede6;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:24px;vertical-align:top;padding-top:2px;">
                      <span style="color:#C41E3A;font-size:16px;">▸</span>
                    </td>
                    <td style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.6;padding-left:8px;">
                      <strong style="color:#1a1a1a;">Analysis &amp; investigations</strong> — independent journalism, free from political or commercial influence
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:24px;vertical-align:top;padding-top:2px;">
                      <span style="color:#C41E3A;font-size:16px;">▸</span>
                    </td>
                    <td style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.6;padding-left:8px;">
                      <strong style="color:#1a1a1a;">Culture &amp; community</strong> — events, people and stories from the heart of Transylvania
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 32px;font-family:Arial,sans-serif;font-size:14px;color:#666;line-height:1.7;font-style:italic;border-left:3px solid #C41E3A;padding-left:16px;">
            We send curated content once a week — no spam, guaranteed.
          </p>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr>
              <td align="center" style="background:#C41E3A;">
                <a href="${SITE_URL}" style="display:inline-block;padding:14px 36px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#ffffff;text-decoration:none;letter-spacing:0.1em;text-transform:uppercase;">
                  Visit Transilvania Times →
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f5f4f0;padding:24px 40px;border-top:1px solid #e5e2d9;">
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:12px;color:#999;line-height:1.6;text-align:center;">
            You received this email because you subscribed to <strong>Transilvania Times</strong>.
          </p>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#bbb;text-align:center;">
            <a href="${SITE_URL}/politica-confidentialitate" style="color:#999;text-decoration:underline;">Privacy Policy</a>
            &nbsp;·&nbsp;
            <a href="${SITE_URL}" style="color:#999;text-decoration:underline;">transilvaniatimes.com</a>
            &nbsp;·&nbsp;
            ADD Individual Solutions Ltd.
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

export async function POST(req: NextRequest) {
  try {
    const { email, language = 'ro' } = await req.json()

    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    const lang = ['ro', 'en'].includes(language) ? language : 'ro'

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { error } = await supabase
      .from('newsletter_subscribers')
      .insert({
        email:     email.trim().toLowerCase(),
        language:  lang,
        confirmed: false,
      })

    if (error) {
      // Already subscribed — still send welcome email
      if (error.code !== '23505') {
        console.error('[newsletter] Supabase insert error:', error.message)
        return NextResponse.json({ error: 'Could not subscribe. Please try again.' }, { status: 500 })
      }
    }

    // Send welcome email via Resend
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const subject = lang === 'en'
        ? 'Welcome to Transilvania Times Newsletter'
        : 'Bun venit la newsletterul Transilvania Times'
      const html = lang === 'en'
        ? welcomeEmailEn(email)
        : welcomeEmailRo(email)

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from:    FROM,
          to:      email.trim().toLowerCase(),
          subject,
          html,
        }),
      })

      if (!resendRes.ok) {
        const err = await resendRes.text()
        console.error('[newsletter] Resend welcome email error:', err)
        // Don't fail the subscription — just log the error
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[newsletter] Fatal:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

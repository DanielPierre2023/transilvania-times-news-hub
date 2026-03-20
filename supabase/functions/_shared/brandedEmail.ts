const LOGO_URL = "https://zimpimoierpsocnmnizm.supabase.co/storage/v1/object/public/blog-images/logo.png";
const SITE_URL = "https://transilvaniatimes.com";

const brandedEmailTemplate = (opts: {
  language: 'en' | 'ro';
  heading: string;
  bodyHtml: string;
  footerExtra?: string;
  ctaText?: string;
  ctaUrl?: string;
}) => {
  const year = new Date().getFullYear();
  const isRo = opts.language === 'ro';
  const footer = isRo
    ? `Transilvania Times · Cluj-Napoca, România`
    : `Transilvania Times · Cluj-Napoca, Romania`;
  const visitSite = isRo ? 'Vizitează site-ul' : 'Visit our website';
  const rights = isRo ? 'Toate drepturile rezervate' : 'All rights reserved';

  const ctaBlock = opts.ctaText && opts.ctaUrl
    ? `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:28px 0 8px;">
        <tr><td align="center">
          <a href="${opts.ctaUrl}" target="_blank" style="display:inline-block;padding:14px 36px;background:#ca2222;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:6px;letter-spacing:.02em;">${opts.ctaText}</a>
        </td></tr>
       </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="${opts.language}">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <!-- Header -->
  <tr><td style="background:#1a1a2e;padding:32px 40px;text-align:center;">
    <h1 style="color:#ffffff;font-family:Georgia,serif;font-size:28px;margin:0;letter-spacing:0.02em;">Transilvania Times</h1>
    <p style="color:#ca2222;font-size:11px;margin:14px 0 0;letter-spacing:.1em;text-transform:uppercase;font-weight:600;">Independent Journalism &middot; Since 2024</p>
  </td></tr>
  <!-- Red divider -->
  <tr><td style="height:3px;background:#ca2222;font-size:0;line-height:0;">&nbsp;</td></tr>
  <!-- Body -->
  <tr><td style="padding:40px 44px;">
    <h1 style="margin:0 0 22px;font-size:21px;color:#1a1a2e;font-weight:700;line-height:1.3;">${opts.heading}</h1>
    <div style="font-size:15px;color:#333333;line-height:1.75;">${opts.bodyHtml}</div>
    ${ctaBlock}
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#f8f9fa;padding:28px 40px;text-align:center;font-size:12px;color:#888888;line-height:1.7;">
    ${opts.footerExtra || ''}
    <p style="margin:10px 0 6px;">
      <a href="${SITE_URL}" target="_blank" style="color:#1a1a2e;text-decoration:none;font-weight:600;">${visitSite} &rarr;</a>
    </p>
    <p style="margin:4px 0 0;color:#aaaaaa;">${footer}<br/>&copy; ${year} ${rights}.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
};

export default brandedEmailTemplate;

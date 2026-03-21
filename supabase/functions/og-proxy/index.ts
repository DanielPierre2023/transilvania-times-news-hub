import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const PROD_DOMAIN = "https://transilvaniatimes.com";
const SITE_NAME = "Transilvania Times";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Detect language from multiple signals:
 * 1. Explicit ?lang=ro query param in the path
 * 2. Accept-Language header containing "ro"
 * 3. Default to "en"
 */
function detectLanguage(pathParam: string, acceptLang: string): string {
  // Check explicit lang param in the proxied path
  try {
    const innerUrl = new URL(pathParam, "https://dummy.local");
    const innerLang = innerUrl.searchParams.get("lang");
    if (innerLang === "ro") return "ro";
    if (innerLang === "en") return "en";
  } catch (_e) { /* ignore */ }

  // Check Accept-Language header
  if (acceptLang) {
    const lower = acceptLang.toLowerCase();
    // If Romanian appears before English or is the primary language
    const roIdx = lower.indexOf("ro");
    const enIdx = lower.indexOf("en");
    if (roIdx !== -1 && (enIdx === -1 || roIdx < enIdx)) return "ro";
  }

  return "en";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParam = url.searchParams.get("path") || "";
  const acceptLang = req.headers.get("accept-language") || "";

  const match = pathParam.match(/^\/blog\/([^/?#]+)/);
  if (!match) {
    return new Response("Missing or invalid path", { status: 400, headers: corsHeaders });
  }

  const slug = match[1];
  const lang = detectLanguage(pathParam, acceptLang);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const apiUrl = supabaseUrl + "/rest/v1/blog_posts" +
    "?slug=eq." + encodeURIComponent(slug) +
    "&status=eq.published" +
    "&select=title_en,title_ro,excerpt_en,excerpt_ro,seo_title_en,seo_title_ro,seo_description_en,seo_description_ro,summary_en,summary_ro,cover_image,published_at,updated_at,author_name,tags,tags_en,tags_ro,slug" +
    "&limit=1";

  const res = await fetch(apiUrl, {
    headers: { "apikey": supabaseKey, "Authorization": "Bearer " + supabaseKey },
  });

  const rows = await res.json();
  const post = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

  if (!post) {
    return new Response(
      "<html><body><h1>404</h1></body></html>",
      { status: 404, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  // ═══════════════════════════════════════════════════
  // CENTRALIZED LOCALIZED RESOLVER — same logic as BlogPost.tsx
  // title: seo_title_{lang} -> title_{lang} -> title_en
  // description: seo_description_{lang} -> summary_{lang} -> excerpt_{lang} -> summary_en -> excerpt_en
  // ═══════════════════════════════════════════════════
  const title = lang === "ro"
    ? (post.seo_title_ro || post.title_ro || post.title_en)
    : (post.seo_title_en || post.title_en);
  const description = lang === "ro"
    ? (post.seo_description_ro || post.summary_ro || post.excerpt_ro || post.summary_en || post.excerpt_en || "")
    : (post.seo_description_en || post.summary_en || post.excerpt_en || "");
  const image = post.cover_image || "";
  const canonicalUrl = PROD_DOMAIN + "/blog/" + post.slug;
  const authorName = post.author_name || SITE_NAME;
  const locale = lang === "ro" ? "ro_RO" : "en_US";
  const altLocale = lang === "ro" ? "en_US" : "ro_RO";

  // Use language-specific tags with fallback
  const tags = lang === "ro"
    ? (post.tags_ro?.length ? post.tags_ro : post.tags_en?.length ? post.tags_en : post.tags || [])
    : (post.tags_en?.length ? post.tags_en : post.tags || []);

  const t = esc(title);
  const d = esc(description);
  const i = esc(image);
  const a = esc(authorName);
  const c = esc(canonicalUrl);

  const tagsMeta = (tags as string[]).map((tag: string) =>
    `  <meta property="article:tag" content="${esc(tag)}" />`
  ).join("\n");
  const pubMeta = post.published_at ? `  <meta property="article:published_time" content="${post.published_at}" />` : "";
  const modMeta = post.updated_at ? `  <meta property="article:modified_time" content="${post.updated_at}" />` : "";

  const html = [
    "<!DOCTYPE html>",
    `<html lang="${lang}">`,
    "<head>",
    `  <meta charset="utf-8" />`,
    `  <title>${t}</title>`,
    `  <meta name="description" content="${d}" />`,
    `  <meta name="author" content="${a}" />`,
    `  <link rel="canonical" href="${c}" />`,
    `  <link rel="alternate" hreflang="en" href="${c}" />`,
    `  <link rel="alternate" hreflang="ro" href="${c}" />`,
    `  <link rel="alternate" hreflang="x-default" href="${c}" />`,
    `  <meta property="og:type" content="article" />`,
    `  <meta property="og:title" content="${t}" />`,
    `  <meta property="og:description" content="${d}" />`,
    `  <meta property="og:image" content="${i}" />`,
    `  <meta property="og:url" content="${c}" />`,
    `  <meta property="og:site_name" content="${SITE_NAME}" />`,
    `  <meta property="og:locale" content="${locale}" />`,
    `  <meta property="og:locale:alternate" content="${altLocale}" />`,
    pubMeta,
    modMeta,
    `  <meta property="article:author" content="${a}" />`,
    tagsMeta,
    `  <meta name="twitter:card" content="summary_large_image" />`,
    `  <meta name="twitter:title" content="${t}" />`,
    `  <meta name="twitter:description" content="${d}" />`,
    `  <meta name="twitter:image" content="${i}" />`,
    "</head>",
    "<body>",
    `  <h1>${t}</h1>`,
    `  <p>${d}</p>`,
    "</body>",
    "</html>",
  ].join("\n");

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
});

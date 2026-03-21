import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const PROD_DOMAIN = "https://transilvaniatimes.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParam = url.searchParams.get("path") || "";

  const match = pathParam.match(/^\/blog\/([^/?#]+)/);
  if (!match) {
    return new Response("Missing or invalid path", { status: 400, headers: corsHeaders });
  }

  const slug = match[1];

  let lang = "en";
  try {
    const innerUrl = new URL(pathParam, "https://dummy.local");
    const innerLang = innerUrl.searchParams.get("lang");
    if (innerLang === "ro") lang = "ro";
  } catch (_e) { /* ignore */ }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const apiUrl = supabaseUrl + "/rest/v1/blog_posts" +
    "?slug=eq." + encodeURIComponent(slug) +
    "&status=eq.published" +
    "&select=title_en,title_ro,excerpt_en,excerpt_ro,seo_title_en,seo_title_ro,seo_description_en,seo_description_ro,summary_en,summary_ro,cover_image,published_at,updated_at,author_name,tags,slug" +
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

  const title = lang === "ro"
    ? (post.seo_title_ro || post.title_ro || post.title_en)
    : (post.seo_title_en || post.title_en);
  const description = lang === "ro"
    ? (post.seo_description_ro || post.excerpt_ro || post.summary_ro || post.excerpt_en || "")
    : (post.seo_description_en || post.excerpt_en || post.summary_en || "");
  const image = post.cover_image || "";
  const canonicalUrl = PROD_DOMAIN + "/blog/" + post.slug;
  const authorName = post.author_name || "Transilvania Times";
  const tags = (post.tags || []) as string[];

  const t = esc(title);
  const d = esc(description);
  const i = esc(image);
  const a = esc(authorName);
  const c = esc(canonicalUrl);

  const tagsMeta = tags.map((tag: string) =>
    `  <meta property="article:tag" content="${esc(tag)}" />`
  ).join("\n");
  const pubMeta = post.published_at ? `  <meta property="article:published_time" content="${post.published_at}" />` : "";
  const modMeta = post.updated_at ? `  <meta property="article:modified_time" content="${post.updated_at}" />` : "";

  const html = [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    `  <meta charset="utf-8" />`,
    `  <title>${t}</title>`,
    `  <meta name="description" content="${d}" />`,
    `  <meta name="author" content="${a}" />`,
    `  <link rel="canonical" href="${c}" />`,
    `  <meta property="og:type" content="article" />`,
    `  <meta property="og:title" content="${t}" />`,
    `  <meta property="og:description" content="${d}" />`,
    `  <meta property="og:image" content="${i}" />`,
    `  <meta property="og:url" content="${c}" />`,
    `  <meta property="og:site_name" content="Transilvania Times" />`,
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

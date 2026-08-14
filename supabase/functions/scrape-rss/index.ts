import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function extractText(xml: string, tag: string): string {
  const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'));
  if (cdataMatch) return cdataMatch[1].trim();
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

/**
 * SSRF guard for outbound fetches in this function.
 *
 * This function accepts an arbitrary URL (the RSS feed URL, and then every
 * <link> it parses out of that feed's items) and fetches it server-side from
 * inside the Supabase edge runtime. Without validation, a malicious or
 * compromised feed_url could point this function at:
 *   - cloud metadata endpoints (169.254.169.254) to steal instance credentials
 *   - internal-only hosts/IPs (10.x, 172.16-31.x, 192.168.x, 127.x, localhost)
 *   - non-http(s) schemes (file:, gopher:, etc.)
 * requireAdmin() already restricts *who* can call this endpoint, but an SSRF
 * guard is defense-in-depth against a compromised admin session or a
 * malicious feed masquerading as a legitimate RSS source.
 */
function isSafeExternalUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;

  const host = u.hostname.toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;

  // IPv4 literal checks (private/reserved/loopback/link-local, incl. cloud metadata).
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [parseInt(ipv4Match[1], 10), parseInt(ipv4Match[2], 10)];
    if (a === 127) return false; // loopback
    if (a === 10) return false; // private
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 169 && b === 254) return false; // link-local incl. cloud metadata
    if (a === 0) return false;
  }

  // IPv6 loopback / link-local / unique-local literals.
  if (host === '::1' || host === '[::1]') return false;
  if (host.startsWith('fe80:') || host.startsWith('[fe80:')) return false;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('[fc') || host.startsWith('[fd')) return false;

  return true;
}

const FETCH_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB cap, well above any legitimate article/feed page

/**
 * Reads a Response body up to a byte cap, aborting the stream once exceeded,
 * so a malicious/oversized endpoint can't exhaust memory or runtime.
 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/\s+/g, ' ').trim();
}

/**
 * Fetch full article body from URL using readability-style extraction.
 * Falls back to RSS snippet if fetch fails.
 */
async function fetchFullArticle(url: string): Promise<{ body: string; wordCount: number }> {
  if (!isSafeExternalUrl(url)) return { body: '', wordCount: 0 };
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TransilvaniaTimes/1.0; +https://transilvaniatimes.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { body: '', wordCount: 0 };
    // Redirects are followed automatically by fetch; re-validate the final
    // landing URL so a feed can't redirect a safe-looking link to an
    // internal/blocked host after the initial check.
    if (!isSafeExternalUrl(res.url)) return { body: '', wordCount: 0 };

    const html = await readCapped(res, MAX_RESPONSE_BYTES);

    // Extract main content using common article selectors
    // Try <article> first, then common content divs
    let content = '';

    // Strategy 1: <article> tag
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      content = articleMatch[1];
    }

    // Strategy 2: Common content containers
    if (!content || stripHtml(content).split(/\s+/).length < 100) {
      const selectors = [
        /<div[^>]*class="[^"]*(?:article-body|post-content|entry-content|article-content|story-body|article__body|td-post-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*id="[^"]*(?:article-body|post-content|entry-content|article-content|story-body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<main[^>]*>([\s\S]*?)<\/main>/i,
      ];
      for (const sel of selectors) {
        const m = html.match(sel);
        if (m && stripHtml(m[1]).split(/\s+/).length > 100) {
          content = m[1];
          break;
        }
      }
    }

    // Strategy 3: All <p> tags from body
    if (!content || stripHtml(content).split(/\s+/).length < 100) {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) {
        const paragraphs = bodyMatch[1].match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
        // Filter out short nav/footer paragraphs
        const meaningful = paragraphs.filter(p => stripHtml(p).split(/\s+/).length > 8);
        content = meaningful.join('\n\n');
      }
    }

    if (!content) return { body: '', wordCount: 0 };

    // Clean extracted HTML to plain text
    const cleaned = stripHtml(content);
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;

    return { body: cleaned.slice(0, 25000), wordCount };
  } catch {
    return { body: '', wordCount: 0 };
  }
}

import { requireAdmin } from "../_shared/requireAdmin.ts";
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const { feed_url } = await req.json();
    if (!feed_url || !isSafeExternalUrl(feed_url)) {
      return new Response(JSON.stringify({ error: 'Invalid or disallowed feed_url' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const res = await fetch(feed_url, {
      headers: { 'User-Agent': 'TransilvaniaTimes-RSS/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!isSafeExternalUrl(res.url)) {
      return new Response(JSON.stringify({ error: 'Feed redirected to a disallowed host' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const xml = await readCapped(res, MAX_RESPONSE_BYTES);
    const articles: Array<{
      title: string;
      url: string;
      content_snippet: string;
      content_full: string;
      source_word_count: number;
    }> = [];
    const itemRegex = /<(item|entry)[\s>]([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && articles.length < 20) {
      const block = match[2];
      const title = stripHtml(extractText(block, 'title'));
      const link = block.match(/<link[^>]*href="([^"]+)"/)?.[1] || extractText(block, 'link');
      const rawContent = extractText(block, 'content:encoded') || extractText(block, 'description') || extractText(block, 'summary') || extractText(block, 'content');
      const snippet = stripHtml(rawContent);

      if (title && link) {
        // Fetch full article body from the URL
        const { body: fullBody, wordCount } = await fetchFullArticle(link);

        articles.push({
          title,
          url: link,
          content_snippet: snippet.slice(0, 8000),
          content_full: fullBody || snippet.slice(0, 25000),
          source_word_count: wordCount || snippet.split(/\s+/).filter(Boolean).length,
        });
      }
    }
    return new Response(JSON.stringify({ articles }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

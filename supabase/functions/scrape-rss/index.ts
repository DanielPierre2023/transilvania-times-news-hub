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
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TransilvaniaTimes/1.0; +https://transilvaniatimes.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) return { body: '', wordCount: 0 };

    const html = await res.text();

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { feed_url } = await req.json();
    const res = await fetch(feed_url, {
      headers: { 'User-Agent': 'TransilvaniaTimes-RSS/1.0' },
    });
    const xml = await res.text();
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

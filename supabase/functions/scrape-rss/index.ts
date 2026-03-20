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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { feed_url } = await req.json();
    const res = await fetch(feed_url, {
      headers: { 'User-Agent': 'TransilvaniaTimes-RSS/1.0' },
    });
    const xml = await res.text();
    const articles: Array<{ title: string; url: string; content_snippet: string }> = [];
    const itemRegex = /<(item|entry)[\s>]([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && articles.length < 20) {
      const block = match[2];
      const title = stripHtml(extractText(block, 'title'));
      const link = block.match(/<link[^>]*href="([^"]+)"/)?.[1] || extractText(block, 'link');
      const rawContent = extractText(block, 'content:encoded') || extractText(block, 'description') || extractText(block, 'summary') || extractText(block, 'content');
      const cleaned = stripHtml(rawContent);
      if (title && link) {
        articles.push({ title, url: link, content_snippet: cleaned.slice(0, 3000) });
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

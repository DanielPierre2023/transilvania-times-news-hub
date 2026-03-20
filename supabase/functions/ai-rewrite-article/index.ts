import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeContent } from "../_shared/sanitize.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const EDITORS: Record<string, string> = {
  daniel_dobos: `You are Daniel Dobos, a senior technology editor. Systems-level precision, clean structured prose, dry wit.`,
  marcus_webb: `You are Marcus Webb, a former Reuters correspondent. Precise, evidence-driven, dry British wit. Investigative features style.`,
  elena_vasilescu: `You are Elena Vasilescu, a former science editor. Elegant prose with illuminating metaphors. Warmth with intellectual rigor.`,
  james_chen: `You are James Chen, a former Wired senior writer. Scene-setting storytelling. Cultural references woven into tech narratives.`,
  sofia_marinescu: `You are Sofia Marinescu, a former Nature contributor. Academic rigor with journalistic readability. Sardonic asides.`,
  daniel_novak: `You are Daniel Novak, a former Ars Technica reviewer. Architecture-focused: layers, data flow, engineering decisions.`,
};

const RULES = `RULES: ZERO subheadings (no ## or ###). No bold-on-own-line. NO conclusion. Vary paragraph length. ZERO AI fingerprints. Sentence-case. 100% original phrasing. Tags: 6-9 lowercase hyphenated SEO tags.`;
const ROMANIAN_RULES = `ROMÂNĂ: ZERO subtitluri. Proză continuă. NU concluzie. Cuvinte interzise: crucial, esențial, robust, vital, paradigmă, ecosistem, sinergie, peisajul. Sentence case. Scrie nativ.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const { article_id, editor = 'marcus_webb' } = await req.json();
  if (!article_id) {
    return new Response(JSON.stringify({ error: 'article_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const doWork = async () => {
    try {
      const { data: article, error: fetchErr } = await supabaseAdmin
        .from('scraped_articles').select('original_content, original_title').eq('id', article_id).single();
      if (fetchErr || !article) {
        await supabaseAdmin.from('scraped_articles').update({ status: 'scraped' }).eq('id', article_id);
        return;
      }

      const apiKey = Deno.env.get('OPENAI_API_KEY');
      const persona = EDITORS[editor] || EDITORS.marcus_webb;

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: `Current date: March 2026.\n\n${persona}\n\n${RULES}\n\n${ROMANIAN_RULES}\n\nRewrite in BOTH English and Romanian. Each at least 1200 words. Romanian written NATIVELY.\n\nRespond ONLY with valid JSON:\n{"title_en":"...","title_ro":"...","excerpt_en":"...","excerpt_ro":"...","summary_en":"...","summary_ro":"...","content_en":"...","content_ro":"...","tags":["..."],"seo_title_en":"...","seo_title_ro":"...","seo_description_en":"...","seo_description_ro":"..."}` },
            { role: 'user', content: `Rewrite this article in both English and Romanian.\n\nTitle: ${article.original_title}\n\nContent:\n${article.original_content}` },
          ],
          temperature: 0.85,
          max_tokens: 8000,
        }),
      });

      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content || '{}';
      let parsed;
      try { parsed = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '')); } catch { parsed = {}; }

      const { error: updateErr } = await supabaseAdmin.from('scraped_articles').update({
        rewritten_en: sanitizeContent(parsed.content_en || '', 'en'),
        rewritten_ro: sanitizeContent(parsed.content_ro || '', 'ro'),
        title_en: sanitizeContent(parsed.title_en || article.original_title, 'en'),
        title_ro: sanitizeContent(parsed.title_ro || article.original_title, 'ro'),
        excerpt_en: sanitizeContent(parsed.excerpt_en || '', 'en'),
        excerpt_ro: sanitizeContent(parsed.excerpt_ro || '', 'ro'),
        summary_en: sanitizeContent(parsed.summary_en || '', 'en'),
        summary_ro: sanitizeContent(parsed.summary_ro || '', 'ro'),
        rewrite_tags: parsed.tags || [],
        seo_title_en: sanitizeContent(parsed.seo_title_en || '', 'en'),
        seo_title_ro: sanitizeContent(parsed.seo_title_ro || '', 'ro'),
        seo_description_en: sanitizeContent(parsed.seo_description_en || '', 'en'),
        seo_description_ro: sanitizeContent(parsed.seo_description_ro || '', 'ro'),
        status: 'rewritten',
      }).eq('id', article_id);

      if (updateErr) console.error('Failed to update article:', updateErr);
      else console.log(`Article ${article_id} rewritten successfully`);
    } catch (e) {
      console.error('Rewrite failed:', e);
      await supabaseAdmin.from('scraped_articles').update({ status: 'scraped' }).eq('id', article_id);
    }
  };

  const workPromise = doWork();
  const response = new Response(JSON.stringify({ status: 'processing', article_id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

  // @ts-ignore
  if (typeof globalThis.EdgeRuntime !== 'undefined' && typeof globalThis.EdgeRuntime.waitUntil === 'function') {
    // @ts-ignore
    globalThis.EdgeRuntime.waitUntil(workPromise);
  } else {
    await workPromise;
  }

  return response;
});

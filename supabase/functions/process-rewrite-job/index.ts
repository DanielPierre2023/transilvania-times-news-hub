import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeContent, humanizeContent } from "../_shared/sanitize.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const EDITORS: Record<string, string> = {
  daniel_dobos: `You are Daniel Dobos, a senior technology editor. Systems-level precision, clean structured prose.`,
  marcus_webb: `You are Marcus Webb, a former Reuters correspondent. Precise, evidence-driven, dry British wit.`,
  elena_vasilescu: `You are Elena Vasilescu, a former science editor. Elegant prose, illuminating metaphors.`,
  james_chen: `You are James Chen, a former Wired writer. Scene-setting, cultural references in tech.`,
  sofia_marinescu: `You are Sofia Marinescu, a former Nature contributor. Academic rigor, journalistic readability.`,
  daniel_novak: `You are Daniel Novak, a former Ars Technica reviewer. Architecture-focused, precise.`,
};

const RULES = `RULES: ZERO subheadings. No bold-on-own-line. NO conclusion. Vary paragraph length. ZERO AI fingerprints. Sentence-case. 100% original. Tags: 6-9 lowercase hyphenated SEO.`;
const ROMANIAN_RULES = `ROMÂNĂ: ZERO subtitluri. Proză continuă. NU concluzie. Cuvinte interzise: crucial, esențial, robust, vital, paradigmă, ecosistem, sinergie, peisajul. Sentence case. Scrie nativ.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let jobId: string | null = null;
  let articleId: string | null = null;

  try {
    const body = await req.json();
    jobId = body.job_id;
    if (!jobId) {
      return new Response(JSON.stringify({ ok: false, code: 'MISSING_JOB_ID' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: job, error: claimErr } = await supabaseAdmin
      .from('rewrite_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', jobId).eq('status', 'queued').select('*').single();

    if (claimErr || !job) {
      return new Response(JSON.stringify({ ok: false, code: 'CLAIM_FAILED' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    articleId = job.article_id;
    const editor = job.editor || 'marcus_webb';

    const { data: article, error: fetchErr } = await supabaseAdmin
      .from('scraped_articles').select('original_content, original_title').eq('id', articleId).single();

    if (fetchErr || !article) throw new Error(`Article not found: ${fetchErr?.message}`);

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    const persona = EDITORS[editor] || EDITORS.marcus_webb;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `Current date: March 2026.\n\n${persona}\n\n${RULES}\n\n${ROMANIAN_RULES}\n\nRewrite in BOTH English and Romanian. Each 1200+ words. Romanian written NATIVELY.\n\nRespond with valid JSON:\n{"title_en":"...","title_ro":"...","excerpt_en":"...","excerpt_ro":"...","summary_en":"...","summary_ro":"...","content_en":"...","content_ro":"...","tags":["..."],"seo_title_en":"...","seo_title_ro":"...","seo_description_en":"...","seo_description_ro":"..."}` },
          { role: 'user', content: `Rewrite:\n\nTitle: ${article.original_title}\n\nContent:\n${article.original_content}` },
        ],
        temperature: 0.85,
        max_tokens: 8000,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(data?.error || data)}`);

    const raw = data.choices?.[0]?.message?.content || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end > start) { try { parsed = JSON.parse(raw.substring(start, end + 1)); } catch { throw new Error('OPENAI_BAD_JSON'); } }
      else throw new Error('OPENAI_BAD_JSON');
    }

    let contentEn = sanitizeContent(parsed.content_en || '', 'en');
    let contentRo = sanitizeContent(parsed.content_ro || '', 'ro');
    if (!contentEn || contentEn.length < 200) throw new Error(`EN content too short: ${contentEn?.length || 0}`);
    if (!contentRo || contentRo.length < 200) throw new Error(`RO content too short: ${contentRo?.length || 0}`);

    contentEn = await humanizeContent(contentEn, 'en', apiKey!);
    contentRo = await humanizeContent(contentRo, 'ro', apiKey!);

    let aiScore: number | null = null;
    let plagiarismScore: number | null = null;
    try {
      const qualityUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/check-content-quality`;
      const qRes = await fetch(qualityUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ content: contentEn, language: 'en', check_plagiarism: true }),
      });
      const qData = await qRes.json();
      aiScore = qData.ai_score ?? null;
      plagiarismScore = qData.plagiarism_score ?? null;
    } catch (e) { console.error('Quality check failed:', (e as Error).message); }

    await supabaseAdmin.from('scraped_articles').update({
      rewritten_en: contentEn, rewritten_ro: contentRo,
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
      status: 'rewritten', rewrite_error: null, rewrite_finished_at: new Date().toISOString(),
      ai_score: aiScore, plagiarism_score: plagiarismScore, quality_checked_at: new Date().toISOString(),
    } as any).eq('id', articleId);

    await supabaseAdmin.from('rewrite_jobs').update({
      status: 'succeeded', finished_at: new Date().toISOString(),
    }).eq('id', jobId);

    return new Response(JSON.stringify({ ok: true, job_id: jobId, status: 'succeeded' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    console.error(`[${jobId}] failed:`, (e as Error).message);
    if (jobId) {
      const { data: failedJob } = await supabaseAdmin.from('rewrite_jobs').select('retry_count, max_retries').eq('id', jobId).single();
      const retryCount = ((failedJob as any)?.retry_count || 0) + 1;
      const maxRetries = (failedJob as any)?.max_retries || 3;
      const newStatus = retryCount < maxRetries ? 'queued' : 'failed';

      await supabaseAdmin.from('rewrite_jobs').update({
        status: newStatus, retry_count: retryCount,
        error_code: (e as Error).message?.startsWith('OPENAI_BAD_JSON') ? 'OPENAI_BAD_JSON' : 'PROCESSING_ERROR',
        error_message: (e as Error).message?.substring(0, 500),
        finished_at: new Date().toISOString(),
      }).eq('id', jobId);

      if (articleId) {
        await supabaseAdmin.from('scraped_articles').update({
          status: newStatus === 'failed' ? 'scraped' : 'rewriting',
          rewrite_error: (e as Error).message?.substring(0, 500),
          rewrite_finished_at: new Date().toISOString(),
        }).eq('id', articleId);
      }

      if (newStatus === 'queued') {
        setTimeout(() => {
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-rewrite-job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
            body: JSON.stringify({ job_id: jobId }),
          }).catch(() => {});
        }, retryCount * 5000);
      }
    }

    return new Response(JSON.stringify({ ok: false, code: 'PROCESSING_ERROR', message: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

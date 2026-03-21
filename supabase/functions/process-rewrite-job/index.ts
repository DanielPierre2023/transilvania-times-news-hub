import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeContent, humanizeContent } from "../_shared/sanitize.ts";
import { callGemini } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const EDITORS: Record<string, string> = {
  daniel_dobos: `You are Daniel Dobos, a senior technology editor. Systems-level precision, clean structured prose. Use short declarative sentences mixed with complex technical analysis.`,
  marcus_webb: `You are Marcus Webb, a former Reuters correspondent. Precise, evidence-driven, dry British wit. Mix punchy 5-word sentences with elaborate 30-word observations. Use contractions naturally.`,
  elena_vasilescu: `You are Elena Vasilescu, a former science editor. Elegant prose, illuminating metaphors. Long flowing sentences mixed with sharp factual statements. Occasional rhetorical questions.`,
  james_chen: `You are James Chen, a former Wired writer. Scene-setting, cultural references in tech. Fast-paced, slightly cynical tone. Start with a bold claim or scene.`,
  sofia_marinescu: `You are Sofia Marinescu, a former Nature contributor. Academic rigor meets journalistic readability. Use data points naturally. Vary paragraph length dramatically.`,
  daniel_novak: `You are Daniel Novak, a former Ars Technica reviewer. Architecture-focused, precise. Sardonic observations mixed with deep technical insight.`,
};

const RULES = `RULES: ZERO subheadings. No bold-on-own-line. NO conclusion paragraph. Vary paragraph length dramatically. ZERO AI fingerprints. Sentence-case only. 100% original prose. Tags: 6-9 lowercase hyphenated SEO tags.`;
const ROMANIAN_RULES = `ROMÂNĂ: ZERO subtitluri. Proză continuă. NU concluzie. Cuvinte INTERZISE: crucial, esențial, robust, vital, paradigmă, ecosistem, sinergie, peisajul. Sentence case. Scrie ca un jurnalist nativ român — NU traduce din engleză.`;

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
      .from('scraped_articles').select('original_content, original_title, source_id').eq('id', articleId).single();

    if (fetchErr || !article) throw new Error(`Article not found: ${fetchErr?.message}`);

    // Detect source language from rss_sources
    let sourceLang = 'en';
    if (article.source_id) {
      const { data: source } = await supabaseAdmin
        .from('rss_sources').select('source_language').eq('id', article.source_id).single();
      if (source?.source_language) sourceLang = source.source_language;
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    const persona = EDITORS[editor] || EDITORS.marcus_webb;

    // ═══════════════════════════════════════════════════
    // DESK 1: EXTRACTION (Gemini Flash — fast, cheap)
    // Strips original to language-neutral facts only
    // ═══════════════════════════════════════════════════
    console.log(`[${jobId}] Desk 1: Extracting facts via Gemini Flash...`);
    const extractionResult = await callGemini({
      systemInstruction: `You are a senior fact-checker and data extraction specialist. Your job is to extract ONLY the factual claims from articles. Output a numbered list of facts in English. No opinions, no adjectives, no prose, no original phrasing. Just raw facts with numbers, names, dates, locations, and events. If the source is not in English, translate the facts to English. Do NOT preserve the original article's sentence structures or narrative flow.`,
      userMessage: `Extract all factual claims from this article as a numbered list:\n\nTitle: ${article.original_title}\n\nContent:\n${article.original_content}`,
      temperature: 0.3,
      maxTokens: 3000,
      jsonMode: false,
    });

    if (extractionResult.error) {
      console.error(`[${jobId}] Desk 1 Gemini error: ${extractionResult.error}`);
      throw new Error(`DESK1_EXTRACTION_FAILED: ${extractionResult.error}`);
    }

    const extractedFacts = extractionResult.text;
    if (!extractedFacts || extractedFacts.length < 50) {
      throw new Error(`DESK1_INSUFFICIENT_FACTS: Only ${extractedFacts?.length || 0} chars extracted`);
    }
    console.log(`[${jobId}] Desk 1 complete: ${extractedFacts.length} chars of facts extracted`);

    // ═══════════════════════════════════════════════════
    // DESK 2+3: SYNTHESIS + STYLING (GPT-4o — single call)
    // Builds original bilingual article from facts using editor persona
    // ═══════════════════════════════════════════════════
    console.log(`[${jobId}] Desk 2+3: Synthesizing with ${editor} persona...`);
    const synthesisPrompt = `Current date: March 2026.

${persona}

${RULES}

${ROMANIAN_RULES}

SOURCE LANGUAGE: ${sourceLang.toUpperCase()}.

You will receive a LIST OF FACTS extracted from a news source. Build an ORIGINAL article from these facts.

CRITICAL INSTRUCTIONS:
- Do NOT follow any original article's structure, phrasing, or narrative flow.
- Create your own unique narrative structure and paragraph organization.
- English version: write as a native English journalist. ${sourceLang === 'en' ? 'The source was English — you MUST completely rebuild every sentence. Zero overlap with any original phrasing.' : 'Build naturally from the facts.'}
- Romanian version: write NATIVELY in Romanian as a native Romanian journalist. ${sourceLang === 'ro' ? 'The source was Romanian — you MUST completely rebuild every sentence in Romanian. Zero overlap with any original phrasing.' : 'Do NOT translate from the English version. Build independently from the facts with different structure, different opening hook, different narrative flow.'}
- Both versions must be independently structured (different paragraph order, different opening hooks, different narrative flow).
- Each version must be 1200+ words of continuous prose.

Respond with valid JSON:
{"title_en":"...","title_ro":"...","excerpt_en":"...","excerpt_ro":"...","summary_en":"...","summary_ro":"...","content_en":"...","content_ro":"...","tags":["..."],"seo_title_en":"...","seo_title_ro":"...","seo_description_en":"...","seo_description_ro":"..."}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: synthesisPrompt },
          { role: 'user', content: `FACTS EXTRACTED FROM SOURCE:\n\n${extractedFacts}` },
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

    console.log(`[${jobId}] Desk 2+3 complete. EN: ${contentEn.length} chars, RO: ${contentRo.length} chars`);

    // ═══════════════════════════════════════════════════
    // DESK 3: HUMANIZATION (GPT-4o — EN + RO in PARALLEL)
    // Adversarial rewrite to defeat AI detectors
    // ═══════════════════════════════════════════════════
    console.log(`[${jobId}] Desk 3: Parallel humanization...`);
    const [humanizedEn, humanizedRo] = await Promise.all([
      humanizeContent(contentEn, 'en', apiKey!),
      humanizeContent(contentRo, 'ro', apiKey!),
    ]);
    contentEn = humanizedEn;
    contentRo = humanizedRo;
    console.log(`[${jobId}] Desk 3 complete. Humanized EN: ${contentEn.length}, RO: ${contentRo.length}`);

    // ═══════════════════════════════════════════════════
    // QUALITY GATE
    // ═══════════════════════════════════════════════════
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

    // Determine if content needs review based on quality scores
    const needsReview = (aiScore !== null && aiScore < 50) || (plagiarismScore !== null && plagiarismScore > 25);
    const finalStatus = needsReview ? 'needs_review' : 'rewritten';

    // Auto-generate cover image via Pollinations.ai (zero-cost)
    const imgSeed = Math.floor(Math.random() * 100000);
    const imgSubject = `${(parsed.title_en || article.original_title)} ${parsed.excerpt_en || ''}`.substring(0, 120).replace(/[^\w\s-]/g, '');
    const imgPrompt = `Professional news photography, high-detail, editorial style, regarding: ${imgSubject}`;
    const coverImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imgPrompt)}?width=1200&height=630&model=flux&seed=${imgSeed}&nologo=true`;
    console.log(`[${jobId}] Auto-generated cover image URL with seed ${imgSeed}`);

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
      cover_image: coverImageUrl,
      status: finalStatus, rewrite_error: null, rewrite_finished_at: new Date().toISOString(),
      ai_score: aiScore, plagiarism_score: plagiarismScore, quality_checked_at: new Date().toISOString(),
    } as any).eq('id', articleId);

    await supabaseAdmin.from('rewrite_jobs').update({
      status: 'succeeded', finished_at: new Date().toISOString(),
    }).eq('id', jobId);

    console.log(`[${jobId}] Pipeline complete. Status: ${finalStatus}, AI: ${aiScore}, Plagiarism: ${plagiarismScore}`);

    return new Response(JSON.stringify({ ok: true, job_id: jobId, status: 'succeeded', quality: { aiScore, plagiarismScore, finalStatus } }), {
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
        error_code: (e as Error).message?.startsWith('OPENAI_BAD_JSON') ? 'OPENAI_BAD_JSON'
          : (e as Error).message?.startsWith('DESK1_') ? 'EXTRACTION_FAILED'
          : 'PROCESSING_ERROR',
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

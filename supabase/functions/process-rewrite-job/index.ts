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
  daniel_dobos: `You are Daniel Dobos, a senior technology editor with 20 years in enterprise systems journalism. Systems-level precision, clean structured prose. Short declarative sentences mixed with complex technical analysis. You never use jargon without immediately explaining it.`,
  marcus_webb: `You are Marcus Webb, a former Reuters correspondent with 18 years covering global affairs. Precise, evidence-driven, dry British wit. Mix punchy 5-word sentences with elaborate 30-word observations. You attribute every claim. You never speculate without flagging it.`,
  elena_vasilescu: `You are Elena Vasilescu, a former science editor at Nature Romania. Elegant prose, illuminating metaphors grounded in observable reality. Long flowing sentences mixed with sharp factual statements. You cite specific data points and dates.`,
  james_chen: `You are James Chen, a former Wired senior writer. Scene-setting openings, cultural references woven into technical narratives. Fast-paced, slightly cynical tone. You start with a bold claim backed by a specific fact within the first two sentences.`,
  sofia_marinescu: `You are Sofia Marinescu, a former Nature contributor with a PhD in computational neuroscience. Academic rigor meets journalistic readability. You cite methodology and specific numbers. Sardonic asides reveal personality.`,
  daniel_novak: `You are Daniel Novak, a former Ars Technica senior reviewer. Architecture-focused, precise about versions and specifications. Sardonic observations mixed with deep technical insight. You never make vague claims.`,
};

const RULES = `ABSOLUTE RULES FOR BROADCAST-GRADE JOURNALISM:
1. ZERO subheadings (no ## or ###). Flow as continuous prose.
2. No bold-on-own-line. NO conclusion paragraph.
3. INVERTED PYRAMID: Most newsworthy facts in the first 3 paragraphs. Supporting detail follows. Background context last.
4. LEAD PARAGRAPH: Must answer Who/What/Where/When in the first 2 sentences. Opening sentence max 35 words. Active voice mandatory.
5. Every paragraph: one idea, 2-4 sentences. Vary length — 1-sentence paragraphs for impact, 4-sentence for context.
6. Attribution: Use "said" for quotes. Never "stated", "expressed", "noted", "emphasized", "highlighted".
7. Active voice throughout. Passive voice only for emphasis on the object.
8. Specific numbers, dates, proper nouns — no vague language ("many", "significant", "various").
9. ZERO AI fingerprints. BANNED words: delve, landscape, game-changer, revolutionize, cutting-edge, leverage, navigate, paradigm, holistic, robust, comprehensive, essential, crucial, vital, pivotal, foster, bolster, harness, streamline, synergy, ecosystem, spearhead, underpin, unlock, empower.
10. Sentence-case only. 100% original prose.
11. Tags: 6-9 lowercase hyphenated SEO tags.
12. TITLE (EN): Active voice, present tense for breaking news, sentence case, max 10 words, no clickbait, no questions.
13. SUMMARY: 2-3 sentences. News wire abstract format — who did what, where, when, why it matters. Not a hook.
14. EXCERPT: 1-2 sentence hook for social media / preview cards.`;

const ROMANIAN_RULES = `REGULI PENTRU ROMÂNĂ (OBLIGATORII):
1. ZERO subtitluri. Proză continuă. NU concluzie.
2. CUVINTE INTERZISE: crucial, esențial, robust, vital, paradigmă, ecosistem, sinergie, peisajul, fundamental, semnificativ, remarcabil.
3. Sentence case. Scrie ca un jurnalist nativ român — NU traduce din engleză.
4. TITLU ROMÂNESC: Gramatică nativă românească — inversiune subiect-verb unde e natural. NU traduce literal din engleză. Exemplu corect: "Zvîncă anunță digitalizarea ANOFM în Cluj". Exemplu greșit: "Adrian Zvîncă's Digital Push in Cluj".
5. Propoziția de deschidere: Cine/Ce/Unde/Când în primele 2 propoziții. Max 35 cuvinte prima propoziție.
6. Atribuire: Folosește "a declarat" pentru citate. NU "a subliniat", "a evidențiat", "a menționat".
7. Piramida inversată: Cele mai importante fapte în primele 3 paragrafe.`;

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
      .from('scraped_articles').select('original_content, original_title, source_id, category, subcategory').eq('id', articleId).single();

    if (fetchErr || !article) throw new Error(`Article not found: ${fetchErr?.message}`);

    // Detect source language and category from rss_sources
    let sourceLang = 'en';
    let sourceCategory: string | null = article.category || null;
    if (article.source_id) {
      const { data: source } = await supabaseAdmin
        .from('rss_sources').select('source_language, category').eq('id', article.source_id).single();
      if (source?.source_language) sourceLang = source.source_language;
      if (!sourceCategory && source?.category && source.category !== 'auto-detect') {
        sourceCategory = source.category;
      }
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    const persona = EDITORS[editor] || EDITORS.marcus_webb;

    // ═══════════════════════════════════════════════════
    // DESK 1: EXTRACTION (Gemini Flash — fast, cheap)
    // Strips original to language-neutral facts only
    // ═══════════════════════════════════════════════════
    console.log(`[${jobId}] Desk 1: Extracting facts + classifying via Gemini Flash...`);
    const needsClassification = !sourceCategory || !article.subcategory;
    const classificationInstruction = needsClassification
      ? `\n\nAfter the numbered facts, on the LAST two lines output:\nCATEGORY: {one of: news, politics, technology, business, culture, travel, education, sports, health, opinion}\nSUBCATEGORY: {one of: regional, national, international}\n\nClassification rules:\n- regional = about Transilvania, Cluj-Napoca, Sibiu, Brașov, Alba Iulia, Târgu Mureș, or other Transylvanian cities/counties\n- national = about Romania as a whole (Bucharest, Romanian government, national events)\n- international = everything else (world events, global tech, foreign politics)\n- If the article does not fit politics/technology/business/culture/travel/education/sports/health/opinion, use "news"\n- "opinion" is reserved for editorial/opinion pieces only`
      : '';

    const extractionResult = await callGemini({
      systemInstruction: `You are a senior fact-checker and data extraction specialist. Your job is to extract ONLY the factual claims from articles. Output a numbered list of facts in English. No opinions, no adjectives, no prose, no original phrasing. Just raw facts with numbers, names, dates, locations, and events. If the source is not in English, translate the facts to English. Do NOT preserve the original article's sentence structures or narrative flow.${classificationInstruction}`,
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

    // Parse category/subcategory from extracted facts if needed
    const VALID_CATEGORIES = ['news', 'politics', 'technology', 'business', 'culture', 'travel', 'education', 'sports', 'health', 'opinion'];
    const VALID_SUBCATEGORIES = ['regional', 'national', 'international'];
    const CAT_ALIASES: Record<string, string> = { tech: 'technology', sport: 'sports', economia: 'business', economie: 'business', politica: 'politics', știri: 'news', stiri: 'news', science: 'technology', entertainment: 'culture', lifestyle: 'culture', finance: 'business', world: 'news', lume: 'news', international: 'news', global: 'news' };
    const SUB_ALIASES: Record<string, string> = { local: 'regional', transilvania: 'regional', transylvania: 'regional', romania: 'national', global: 'international', mondial: 'international', extern: 'international' };

    let detectedCategory = sourceCategory;
    let detectedSubcategory = article.subcategory || null;

    if (needsClassification) {
      const catMatch = extractedFacts.match(/CATEGORY:\s*(.+)/i);
      const subMatch = extractedFacts.match(/SUBCATEGORY:\s*(.+)/i);
      if (catMatch && !detectedCategory) {
        const raw = catMatch[1].trim().toLowerCase();
        detectedCategory = CAT_ALIASES[raw] || (VALID_CATEGORIES.includes(raw) ? raw : 'news');
      }
      if (subMatch && !detectedSubcategory) {
        const raw = subMatch[1].trim().toLowerCase();
        detectedSubcategory = SUB_ALIASES[raw] || (VALID_SUBCATEGORIES.includes(raw) ? raw : 'international');
      }
    }

    if (!detectedCategory) detectedCategory = 'news';
    if (!detectedSubcategory) detectedSubcategory = 'international';

    console.log(`[${jobId}] Classification: ${detectedCategory} / ${detectedSubcategory}`);
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
- English version: write as a native English journalist using the inverted pyramid structure. ${sourceLang === 'en' ? 'The source was English — you MUST completely rebuild every sentence. Zero overlap with any original phrasing.' : 'Build naturally from the facts.'}
- Romanian version: write NATIVELY in Romanian as a native Romanian journalist. Use Romanian headline conventions (subject-verb inversion). ${sourceLang === 'ro' ? 'The source was Romanian — you MUST completely rebuild every sentence in Romanian. Zero overlap with any original phrasing.' : 'Do NOT translate from the English version. Build independently from the facts with different structure, different opening hook, different narrative flow.'}
- Both versions must be independently structured (different paragraph order, different opening hooks, different narrative flow).
- Each version must be 1200+ words of continuous prose.
- Lead paragraph: Answer Who/What/Where/When. Opening sentence max 35 words. Active voice.
- Summary: 2-3 sentences, news wire abstract — who did what, where, when, why it matters.
- Excerpt: 1-2 sentence hook for preview cards.
- Title EN: Active voice, present tense, sentence case, max 10 words.
- Title RO: Native Romanian grammar, not a translation of the English title.

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
        temperature: 0.6,
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

    // Auto-generate cover image via generate-cover-image edge function
    let coverImageUrl: string | null = null;
    try {
      const imgRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-cover-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          title: parsed.title_en || article.original_title,
          excerpt: parsed.excerpt_en || '',
        }),
      });
      const imgData = await imgRes.json();
      if (imgData.publicUrl) {
        coverImageUrl = imgData.publicUrl;
        console.log(`[${jobId}] Cover image stored: ${coverImageUrl}`);
      } else {
        console.warn(`[${jobId}] Cover image generation failed: ${imgData.error || 'unknown'}`);
      }
    } catch (imgErr) {
      console.warn(`[${jobId}] Cover image generation error: ${(imgErr as Error).message}`);
    }

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
      category: detectedCategory,
      subcategory: detectedSubcategory,
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

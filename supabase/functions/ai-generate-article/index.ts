import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sanitizeContent, countWords, humanizeContent } from "../_shared/sanitize.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EDITORS: Record<string, { name: string; system: string }> = {
  daniel_dobos: { name: 'Daniel Dobos', system: `You are Daniel Dobos, a senior technology editor with deep experience in enterprise AI architecture and cloud infrastructure. You write with systems-level precision. Your prose is clean and structured but never dry — measured confidence with occasional dry wit.` },
  marcus_webb: { name: 'Marcus Webb', system: `You are Marcus Webb, a former Reuters technology correspondent with 18 years covering global tech. Your writing is precise and evidence-driven. You have dry British wit. You structure articles like investigative features.` },
  elena_vasilescu: { name: 'Elena Vasilescu', system: `You are Elena Vasilescu, a former science editor who spent twelve years making complex technology accessible. Your prose is elegant — you find metaphors that illuminate. You write with warmth but intellectual rigor.` },
  james_chen: { name: 'James Chen', system: `You are James Chen, a former Wired senior writer known for features that made readers feel they'd traveled somewhere. Your storytelling opens with scenes. You weave cultural references into technical narratives.` },
  sofia_marinescu: { name: 'Sofia Marinescu', system: `You are Sofia Marinescu, a former Nature contributor with a PhD in computational neuroscience. You cite methodology. Your sardonic asides reveal personality. You reference specific papers and conference proceedings.` },
  daniel_novak: { name: 'Daniel Novak', system: `You are Daniel Novak, a former Ars Technica senior reviewer. You love architecture: layers, data flow, engineering decisions. You reference specific tools, frameworks, and version numbers.` },
};

const WORD_COUNT_RULES = (wordCount: number) => `
MANDATORY WORD COUNT — THIS IS YOUR #1 PRIORITY:
Your article MUST contain at least ${Math.round(wordCount * 0.85)} words. Target: ${wordCount} words.
`;

const WRITING_RULES = `
BROADCAST-GRADE JOURNALISM RULES:
1. ZERO subheadings (no ## or ###). Flow as continuous prose.
2. No bold-on-own-line. NO conclusion paragraph.
3. INVERTED PYRAMID: Most newsworthy facts first. Supporting detail follows. Background last.
4. LEAD PARAGRAPH: Answer Who/What/Where/When in the first 2 sentences. Opening sentence max 35 words. Active voice mandatory.
5. Every paragraph: one idea, 2-4 sentences. Vary length — 1-sentence for impact, 4-sentence for context.
6. Attribution: Use "said" for quotes. Never "stated", "expressed", "noted", "emphasized".
7. Active voice throughout. Passive voice only for emphasis on the object.
8. Specific numbers, dates, proper nouns — no vague language ("many", "significant", "various").
9. ZERO AI fingerprints. BANNED: delve, landscape, game-changer, revolutionize, cutting-edge, leverage, navigate, paradigm, holistic, robust, comprehensive, essential, crucial, vital, pivotal, foster, bolster, harness, streamline, synergy, ecosystem.
10. Sentence-case only. 100% original phrasing.
11. Tags: lowercase, hyphenated, specific long-tail SEO keywords.
12. TITLE: Active voice, present tense, sentence case, max 10 words, no clickbait.
13. SUMMARY: 2-3 sentences, news wire abstract — who did what, where, when, why it matters.
14. EXCERPT: 1-2 sentence hook for preview cards.
`;

const ROMANIAN_RULES = `
REGULI PENTRU ROMÂNĂ (OBLIGATORII):
- ZERO subtitluri. Proză continuă. NU concluzie.
- CUVINTE INTERZISE: crucial, esențial, robust, vital, paradigmă, ecosistem, sinergie, peisajul, fundamental, semnificativ.
- Sentence case. Scrie nativ în română — NU traduce din engleză.
- TITLU ROMÂNESC: Gramatică nativă, inversiune subiect-verb unde e natural. NU traduce literal din engleză.
- Propoziția de deschidere: Cine/Ce/Unde/Când în primele 2 propoziții. Max 35 cuvinte.
- Atribuire: "a declarat" pentru citate. NU "a subliniat", "a evidențiat".
- Piramida inversată: Cele mai importante fapte în primele 3 paragrafe.
`;

const CATEGORIES = ['news', 'politics', 'technology', 'business', 'culture', 'travel', 'education', 'sports', 'health', 'opinion'];

async function expandArticle(apiKey: string, content: string, targetWords: number, language: string, editorSystem: string): Promise<string> {
  const currentWords = countWords(content);
  const needed = targetWords - currentWords;
  const expandPrompt = language === 'ro'
    ? `Articolul are doar ${currentWords} cuvinte. Trebuie ${targetWords}. Adaugă profunzime, exemple. NU adăuga subtitluri sau concluzie. Returnează articolul complet extins.`
    : `The article is only ${currentWords} words. It needs ${targetWords}. Add depth, examples. Do NOT add subheadings or conclusion. Return the complete expanded article.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: `${editorSystem}\n\nExpand the article. Add ${needed}+ words of substantive content.` },
        { role: 'user', content: `${expandPrompt}\n\n---\n\n${content}` },
      ],
      temperature: 0.6,
      max_tokens: Math.ceil(targetWords * 2.5),
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || content;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, word_count = 1800, editor = 'marcus_webb', category = 'technology' } = await req.json();
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    const editorProfile = EDITORS[editor] || EDITORS.marcus_webb;
    const maxTokens = Math.max(4000, Math.ceil(word_count * 2.5));
    const wordCountRules = WORD_COUNT_RULES(word_count);

    const enRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: `Current date: March 2026.\n\n${wordCountRules}\n\n${editorProfile.system}\n\n${WRITING_RULES}\n\nCategory: "${category}". Target: ${word_count} words.\n\nRespond ONLY with valid JSON:\n{"title":"...","excerpt":"1-2 sentence hook","summary":"3-5 sentence abstract","content":"full article in markdown","tags":["6-9 tags"],"seo_title":"under 60 chars","seo_description":"under 160 chars"}` },
          { role: 'user', content: `Write a professional article in ENGLISH about: ${prompt}` },
        ],
        temperature: 0.6,
        max_tokens: maxTokens,
      }),
    });
    const enData = await enRes.json();
    if (enData.error) throw new Error(`OpenAI EN error: ${enData.error.message || JSON.stringify(enData.error)}`);
    const enRaw = enData.choices?.[0]?.message?.content || '{}';
    let enArticle;
    try { enArticle = JSON.parse(enRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '')); } catch { enArticle = { title: '', excerpt: '', summary: '', content: enRaw, tags: [], seo_title: '', seo_description: '' }; }

    let enContent = enArticle.content || '';
    if (countWords(enContent) < word_count * 0.7) {
      enContent = await expandArticle(apiKey!, enContent, word_count, 'en', editorProfile.system);
    }

    const roRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: `Current date: March 2026.\n\n${wordCountRules}\n\n${editorProfile.system}\n\n${WRITING_RULES}\n\n${ROMANIAN_RULES}\n\nWrite natively in ROMANIAN. Category: "${category}". Target: ${word_count} words.\n\nRespond ONLY with valid JSON:\n{"title":"titlul","excerpt":"1-2 propoziții","summary":"rezumat 3-5 propoziții","content":"articolul complet în markdown","seo_title":"sub 60 caractere","seo_description":"sub 160 caractere"}` },
          { role: 'user', content: `Write a professional Romanian article about: ${prompt}\n\nKey points: ${enArticle.title}\n${enArticle.excerpt}` },
        ],
        temperature: 0.6,
        max_tokens: maxTokens,
      }),
    });
    const roData = await roRes.json();
    if (roData.error) throw new Error(`OpenAI RO error: ${roData.error.message || JSON.stringify(roData.error)}`);
    const roRaw = roData.choices?.[0]?.message?.content || '{}';
    let roArticle;
    try { roArticle = JSON.parse(roRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '')); } catch { roArticle = { title: enArticle.title || prompt, excerpt: '', summary: '', content: roRaw, seo_title: '', seo_description: '' }; }

    let roContent = roArticle.content || '';
    if (countWords(roContent) < word_count * 0.7) {
      roContent = await expandArticle(apiKey!, roContent, word_count, 'ro', editorProfile.system);
    }

    const slug = (enArticle.title || prompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);

    let finalEn = sanitizeContent(enContent, 'en');
    let finalRo = sanitizeContent(roContent, 'ro');
    finalEn = await humanizeContent(finalEn, 'en', apiKey!);
    finalRo = await humanizeContent(finalRo, 'ro', apiKey!);

    return new Response(JSON.stringify({
      title_en: sanitizeContent(enArticle.title || '', 'en'),
      title_ro: sanitizeContent(roArticle.title || '', 'ro'),
      excerpt_en: sanitizeContent(enArticle.excerpt || '', 'en'),
      excerpt_ro: sanitizeContent(roArticle.excerpt || '', 'ro'),
      summary_en: sanitizeContent(enArticle.summary || '', 'en'),
      summary_ro: sanitizeContent(roArticle.summary || '', 'ro'),
      content_en: finalEn,
      content_ro: finalRo,
      tags: enArticle.tags || [],
      seo_title_en: sanitizeContent(enArticle.seo_title || '', 'en'),
      seo_title_ro: sanitizeContent(roArticle.seo_title || '', 'ro'),
      seo_description_en: sanitizeContent(enArticle.seo_description || '', 'en'),
      seo_description_ro: sanitizeContent(roArticle.seo_description || '', 'ro'),
      slug,
      author_name: editorProfile.name,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

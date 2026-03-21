import { callGemini } from '../_shared/gemini.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { topic, industry, companySize, currentTools } = await req.json();

    const effectiveIndustry = topic || industry || 'Media';

    const systemInstruction = `You are a competitive intelligence analyst for Transilvania Times, an independent bilingual newspaper covering technology, politics, culture, and business from Transylvania, Romania.

You provide sharp, data-driven competitive positioning analysis for media and digital publishing.

Transilvania Times key differentiators:
- Bilingual EN/RO content with AI-assisted editorial pipeline
- Deep coverage of Central/Eastern European technology and business
- Independent editorial voice with experienced journalist personas
- AI-powered content quality assurance and anti-plagiarism checks
- Full RSS scraping and AI rewrite pipeline for rapid news coverage

Always respond in valid JSON.`;

    const userMessage = `Generate a competitive positioning analysis for a prospect in the "${effectiveIndustry}" industry with company size "${companySize || 'mid-market'}" currently using "${currentTools || 'basic CMS'}".

Return JSON with:
{
  "positioning": "2-3 sentence positioning statement",
  "vsEnterprise": ["3 bullet points why Transilvania Times beats large media companies for this prospect"],
  "vsBoutique": ["3 bullet points why Transilvania Times beats boutique publishers for this prospect"],
  "vsNiche": ["3 bullet points why Transilvania Times beats niche blogs for this prospect"],
  "recommendedApproach": "1-2 sentence recommended engagement approach",
  "estimatedROI": "projected ROI statement tailored to their industry"
}`;

    const result = await callGemini({ systemInstruction, userMessage, temperature: 0.6, maxTokens: 3000, jsonMode: true });

    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(result.text, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

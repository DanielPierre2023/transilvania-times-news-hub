import { callGemini } from '../_shared/gemini.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { pageContent, pageUrl, existingSchemas } = await req.json();

    const systemInstruction = `You are a Generative Engine Optimization (GEO) specialist for 2026. You analyze web page content for "AI citability" — the likelihood that generative AI engines (ChatGPT, Perplexity, Google AI Overviews) will cite this content as an authoritative source.

Key GEO principles:
- Semantic richness: content must use precise, domain-specific terminology
- Authority signals: credentials, case studies, specific metrics, named frameworks
- Schema completeness: Organization, LocalBusiness, Service, Person, BreadcrumbList, FAQPage
- Long-tail keyword optimization for conversational AI queries
- Structured data that AI models can parse (JSON-LD, semantic HTML)
- E-E-A-T signals (Experience, Expertise, Authoritativeness, Trustworthiness)

Always respond in valid JSON.`;

    const userMessage = `Analyze this page content for GEO readiness and AI citability:

URL: ${pageUrl || 'unknown'}
Existing schemas: ${existingSchemas || 'none specified'}

Page content (first 3000 chars):
${(pageContent || '').substring(0, 3000)}

Return JSON:
{
  "overallScore": 0-100,
  "semanticRichness": { "score": 0-100, "suggestions": ["..."] },
  "authoritySignals": { "score": 0-100, "suggestions": ["..."] },
  "schemaCompleteness": { "score": 0-100, "missingSchemas": ["..."], "suggestions": ["..."] },
  "longTailKeywords": { "found": ["..."], "recommended": ["..."] },
  "aiCitability": { "score": 0-100, "improvements": ["..."] },
  "topPriorityActions": ["top 3 most impactful actions to take"]
}`;

    const result = await callGemini({ systemInstruction, userMessage, temperature: 0.4, maxTokens: 2000, jsonMode: true });

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

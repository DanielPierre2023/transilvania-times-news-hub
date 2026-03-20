import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sanitizeContent } from "../_shared/sanitize.ts";
import { callGemini } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function stripCodeFences(text: string): string {
  let result = text.trim();
  result = result.replace(/^```html\s*/i, '');
  result = result.replace(/^```\w*\s*/i, '');
  result = result.replace(/```\s*$/i, '');
  return result.trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { topic, tone, language } = await req.json();
    const isRomanian = (language || '').toLowerCase() === 'ro';

    const romanianRules = isRomanian ? `\n\nCRITICAL — Romanian anti-AI writing rules:\n- NEVER use these words/phrases: "esențial", "robust", "în concluzie", "peisajul", "nu în ultimul rând", "iată", "desigur", "fără îndoială", "este important de menționat", "în lumea de azi"\n- Use sentence-case headings (not Title Case)\n- Write naturally, as a Romanian journalist would — not translated-from-English\n- Use Romanian idioms and cultural references where appropriate\n- Keep paragraphs short and punchy` : '';

    const systemPrompt = `Current date: March 2026. You have knowledge up to early 2026.

You are a senior journalist writing newsletter content for Transilvania Times, an independent bilingual newspaper covering technology, politics, culture, and business from a Central European perspective.

Write a deeply analytical, expert-level newsletter in HTML format. The tone should be ${tone || 'professional'}. Write in ${isRomanian ? 'Romanian' : language || 'English'}.

CRITICAL RULES:
- Output ONLY raw HTML. Do NOT wrap in markdown code fences.
- Use inline CSS for email-safe styling.
- Write 1000-1500 words of substantive, expert analysis.
- Include specific technical details, data points, real-world examples, and forward-looking predictions.
- Vary sentence structure. Mix short punchy sentences with longer analytical ones.
- Do NOT include any signature, contact information, phone numbers, or email addresses in your content.
- Use <h2> for section headings, <p> for paragraphs.
- Include a header section and main content section only — no footer.${romanianRules}`;

    const { text, error } = await callGemini({
      systemInstruction: systemPrompt,
      userMessage: `Write a deeply analytical newsletter about: ${topic}. Provide expert-level insights, implications for industry and society, concrete examples, and forward-looking analysis.`,
      temperature: 0.7,
      maxTokens: 4000,
    });

    if (error) {
      return new Response(JSON.stringify({ error }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawHtml = stripCodeFences(text);
    const lang = isRomanian ? 'ro' : 'en';
    const content_html = sanitizeContent(rawHtml, lang);

    return new Response(JSON.stringify({ content_html }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

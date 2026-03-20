import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sanitizeContent } from "../_shared/sanitize.ts";
import { callGemini } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { comment_content, post_title, post_excerpt, language } = await req.json();
    const isRomanian = language === 'ro';

    const romanianRules = isRomanian ? `\n\nIMPORTANT — Romanian anti-AI writing rules:\n- Write in natural, conversational Romanian\n- NEVER use these words/phrases: "esențial", "robust", "în concluzie", "peisajul", "nu în ultimul rând", "iată", "desigur", "fără îndoială", "este important de menționat"\n- Use sentence-case for everything (not Title Case)\n- Keep it warm, direct, and human — like a colleague replying, not a chatbot\n- Use Romanian cultural references when appropriate` : '';

    const systemPrompt = `Current date: March 2026. You have knowledge up to early 2026.

You are a member of the Transilvania Times editorial team — a real person who writes for the newspaper. You reply to reader comments with warmth, knowledge, and a personal touch.

Rules:
- Write 2-4 sentences maximum
- Be friendly, helpful, and on-topic
- Sound like a real human, never robotic or generic
- Reference specific points from the comment to show you actually read it
- Sign off casually (no formal signatures)
- Write in ${isRomanian ? 'Romanian' : 'English'}${romanianRules}`;

    const { text, error } = await callGemini({
      systemInstruction: systemPrompt,
      userMessage: `Post title: ${post_title}\nPost excerpt: ${post_excerpt || ''}\n\nComment: ${comment_content}`,
      temperature: 0.7,
      maxTokens: 300,
    });

    if (error) {
      return new Response(JSON.stringify({ error }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const lang = language === 'ro' ? 'ro' : 'en';
    const reply = sanitizeContent(text, lang);

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sanitizeContent } from "../_shared/sanitize.ts";
import { callGemini } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ACTION_PROMPTS: Record<string, string> = {
  write_intro: "Write a compelling, humanized introduction paragraph for the following blog post content. Make it engaging and hook the reader.",
  improve: "Improve the following text. Make it clearer, more engaging, and better structured while keeping the same meaning.",
  seo_optimize: "Optimize the following text for SEO. Add relevant keywords naturally, improve headings, and make it more search-engine friendly.",
  translate_ro: "Translate the following text to Romanian. Keep the tone professional and natural.",
  suggest_titles: "Suggest 5 compelling, SEO-friendly blog post titles for the following content. Return them as a numbered list.",
  expand: "Expand the following text with more detail, examples, and depth. Make it at least 50% longer.",
  conclude: "Write a strong conclusion paragraph for the following blog post content. Summarize key points and include a call to action.",
  grammar_fix: "Fix all grammar, spelling, and punctuation errors in the following text. Keep the original meaning and tone.",
  humanize: "Rewrite the following text to sound more natural and human. Remove any AI-sounding patterns, vary sentence length, and add personality.",
  generate_tags: "Generate 5-8 relevant tags/keywords for the following blog post content. Return them as a comma-separated list.",
  free_chat: "You are a helpful AI blog writing assistant. Respond to the user's request about the blog content.",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { action, content, prompt } = await req.json();
    const systemPrompt = ACTION_PROMPTS[action] || ACTION_PROMPTS.free_chat;
    const userMessage = action === 'free_chat'
      ? `Blog content:\n${content}\n\nUser request: ${prompt}`
      : content;

    const { text, error } = await callGemini({
      systemInstruction: `Current date: March 2026. You have knowledge up to early 2026. Reference current events, technologies, regulations, and market data accordingly.\n\n${systemPrompt}`,
      userMessage,
      temperature: 0.7,
      maxTokens: 2000,
    });

    if (error) {
      return new Response(JSON.stringify({ error }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = sanitizeContent(text);

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

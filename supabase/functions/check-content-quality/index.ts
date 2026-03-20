import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callGemini } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SENTENCE_START_ADVERBS = [
  'however', 'therefore', 'furthermore', 'moreover', 'additionally',
  'consequently', 'nevertheless', 'nonetheless', 'meanwhile', 'similarly',
  'conversely', 'subsequently', 'accordingly', 'alternatively', 'notably',
  'specifically', 'importantly', 'significantly', 'interestingly',
  'totuși', 'prin urmare', 'în plus', 'mai mult', 'de asemenea',
  'cu toate acestea', 'în consecință', 'astfel', 'totodată',
];

const BANNED_RESIDUALS = [
  'delve', 'landscape', 'game-changer', 'cutting-edge', 'paradigm shift',
  'holistic', 'synergy', 'ecosystem', 'empower', 'unlock potential',
  'foster', 'bolster', 'harness', 'streamline', 'spearhead',
  'pivotal', 'leverage', 'navigate', 'robust', 'comprehensive',
  'peisajul', 'paradigmă', 'sinergie', 'ecosistem', 'holistic',
  'a valorifica', 'a debloca',
];

function getSentences(text: string): string[] {
  return text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
}

function getParagraphs(text: string): string[] {
  return text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 20);
}

function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((sum, n) => sum + (n - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

function heuristicScore(text: string): { score: number; breakdown: Record<string, number> } {
  const sentences = getSentences(text);
  const paragraphs = getParagraphs(text);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  if (wordCount < 50) return { score: 0, breakdown: {} };
  const breakdown: Record<string, number> = {};

  const sentLengths = sentences.map(s => s.split(/\s+/).length);
  const sentStdDev = stdDev(sentLengths);
  breakdown.sentence_variance = sentStdDev < 4 ? 15 : sentStdDev < 6 ? 10 : sentStdDev < 8 ? 5 : 0;

  const paraLengths = paragraphs.map(p => p.split(/\s+/).length);
  const paraStdDev = stdDev(paraLengths);
  breakdown.paragraph_variance = paraStdDev < 15 ? 10 : paraStdDev < 25 ? 5 : 0;

  const semicolons = (text.match(/;/g) || []).length;
  const semicolonRate = (semicolons / wordCount) * 1000;
  breakdown.semicolons = semicolonRate > 8 ? 10 : semicolonRate > 5 ? 6 : semicolonRate > 3 ? 3 : 0;

  const adverbStarts = sentences.filter(s => {
    const firstWord = s.split(/[\s,]+/)[0].toLowerCase();
    return SENTENCE_START_ADVERBS.some(a => firstWord === a || s.toLowerCase().startsWith(a));
  }).length;
  const adverbRate = adverbStarts / Math.max(sentences.length, 1);
  breakdown.adverb_density = adverbRate > 0.15 ? 15 : adverbRate > 0.10 ? 10 : adverbRate > 0.05 ? 5 : 0;

  const passivePatterns = /\b(is|are|was|were|been|being|be)\s+(being\s+)?\w+ed\b/gi;
  const passiveCount = (text.match(passivePatterns) || []).length;
  const passiveRate = passiveCount / Math.max(sentences.length, 1);
  breakdown.passive_voice = passiveRate > 0.3 ? 10 : passiveRate > 0.2 ? 6 : passiveRate > 0.1 ? 3 : 0;

  const avgWordLen = words.reduce((sum, w) => sum + w.replace(/[^a-zA-ZăâîșțĂÂÎȘȚ]/g, '').length, 0) / wordCount;
  breakdown.word_length = avgWordLen > 6.5 ? 8 : avgWordLen > 5.8 ? 4 : 0;

  const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-zA-ZăâîșțĂÂÎȘȚ]/g, '')));
  const ttr = uniqueWords.size / wordCount;
  breakdown.lexical_diversity = ttr < 0.35 ? 10 : ttr < 0.45 ? 6 : ttr < 0.55 ? 3 : 0;

  let sameStructureRuns = 0;
  for (let i = 1; i < sentences.length; i++) {
    const prevFirst = sentences[i - 1].split(/\s+/)[0]?.toLowerCase();
    const currFirst = sentences[i].split(/\s+/)[0]?.toLowerCase();
    if (prevFirst && prevFirst === currFirst) sameStructureRuns++;
  }
  breakdown.repetitive_structure = sameStructureRuns > 5 ? 12 : sameStructureRuns > 3 ? 8 : sameStructureRuns > 1 ? 4 : 0;

  const textLower = text.toLowerCase();
  const bannedFound = BANNED_RESIDUALS.filter(w => textLower.includes(w));
  breakdown.banned_residuals = bannedFound.length > 3 ? 10 : bannedFound.length > 1 ? 6 : bannedFound.length > 0 ? 3 : 0;

  const totalScore = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score: Math.min(100, totalScore), breakdown };
}

async function adversarialCheck(text: string): Promise<{ score: number; flags: Array<{ sentence: string; reason: string }> }> {
  try {
    const truncated = text.length > 4000 ? text.substring(0, 4000) : text;
    const { text: rawResponse, error } = await callGemini({
      systemInstruction: `You are an AI detection expert. Analyze the provided text for signs of AI generation. Score 0-100 (0 = definitely human-written, 100 = definitely AI-generated). Respond as JSON: {"score": number, "flags": [{"sentence": "exact text", "reason": "why it seems AI"}]}`,
      userMessage: truncated,
      temperature: 0.2,
      maxTokens: 1000,
      jsonMode: true,
    });
    if (error) return { score: 50, flags: [{ sentence: '', reason: `Gemini error: ${error}` }] };
    try {
      const parsed = JSON.parse(rawResponse);
      return { score: Math.max(0, Math.min(100, parsed.score || 0)), flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 10) : [] };
    } catch (_e) {
      return { score: 50, flags: [{ sentence: '', reason: 'Failed to parse adversarial response' }] };
    }
  } catch (e) {
    return { score: 50, flags: [{ sentence: '', reason: `Adversarial check error: ${(e as Error).message}` }] };
  }
}

function extractNgrams(text: string, n: number): Set<string> {
  const words = text.toLowerCase().replace(/[^a-zA-ZăâîșțĂÂÎȘȚ0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0);
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

function ngramOverlap(set1: Set<string>, set2: Set<string>): number {
  if (set1.size === 0 || set2.size === 0) return 0;
  let overlap = 0;
  for (const gram of set1) { if (set2.has(gram)) overlap++; }
  return (overlap / set1.size) * 100;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { content, language = 'en', check_plagiarism = true } = await req.json();
    if (!content || content.length < 100) {
      return new Response(JSON.stringify({ error: 'Content too short for quality check' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const heuristic = heuristicScore(content);
    const adversarial = await adversarialCheck(content);
    const combinedAiScore = Math.round(heuristic.score * 0.4 + adversarial.score * 0.6);

    let plagiarismScore = 0;
    if (check_plagiarism) {
      try {
        const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { data: existingPosts } = await supabaseAdmin.from('blog_posts').select('content_en, content_ro').eq('status', 'published').order('created_at', { ascending: false }).limit(50);
        if (existingPosts && existingPosts.length > 0) {
          const newNgrams = extractNgrams(content, 5);
          let maxOverlap = 0;
          for (const post of existingPosts) {
            const postContent = language === 'ro' ? (post.content_ro || '') : (post.content_en || '');
            if (postContent.length < 100) continue;
            const postNgrams = extractNgrams(postContent, 5);
            const overlap = ngramOverlap(newNgrams, postNgrams);
            maxOverlap = Math.max(maxOverlap, overlap);
          }
          plagiarismScore = Math.round(maxOverlap * 10) / 10;
        }
      } catch (e) { console.error('Plagiarism check failed:', e); }
    }

    const passed = combinedAiScore <= 50 && plagiarismScore <= 50;

    return new Response(JSON.stringify({
      ai_score: combinedAiScore, heuristic_score: heuristic.score, heuristic_breakdown: heuristic.breakdown,
      adversarial_score: adversarial.score, adversarial_flags: adversarial.flags, plagiarism_score: plagiarismScore, passed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

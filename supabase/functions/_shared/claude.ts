// supabase/functions/_shared/claude.ts
// Anthropic Claude API helper — mirrors gemini.ts interface exactly
// Models: Claude Haiku 4.5 (fast/cheap) | Claude Sonnet 4.6 (best quality)
// JWT Verification: N/A — shared helper, not a function

export const CLAUDE_HAIKU  = 'claude-haiku-4-5-20251001';
export const CLAUDE_SONNET = 'claude-sonnet-4-6';

interface ClaudeRequest {
  systemInstruction: string;
  userMessage:       string;
  temperature?:      number;
  maxTokens?:        number;
  jsonMode?:         boolean;
  model?:            string;
}

interface ClaudeResponse {
  text:   string;
  error?: string;
}

// Exponential backoff retry — Claude Haiku rate limits at high volume
async function fetchWithRetry(
  body: object,
  apiKey: string,
  attempt = 0
): Promise<Response> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':       'application/json',
      'anthropic-version':  '2023-06-01',
      'x-api-key':          apiKey,
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (res.status === 429 && attempt < 3) {
    const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
    console.warn(`[Claude] Rate limited. Retrying in ${delay}ms (attempt ${attempt + 1}/3)`);
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(body, apiKey, attempt + 1);
  }
  return res;
}

export async function callClaude({
  systemInstruction,
  userMessage,
  temperature = 0.7,
  maxTokens   = 4096,
  jsonMode    = false,
  model       = CLAUDE_HAIKU,
}: ClaudeRequest): Promise<ClaudeResponse> {
  const apiKey = Deno.env.get('CLAUDE_API_KEY');
  if (!apiKey) return { text: '', error: 'CLAUDE_API_KEY not configured' };

  // Claude does not have a native JSON mode like OpenAI — enforce via system prompt
  const system = jsonMode
    ? `${systemInstruction}\n\nCRITICAL: Respond with ONLY a valid JSON object. No markdown, no backticks, no preamble, no explanation. Start your response with { and end with }.`
    : systemInstruction;

  try {
    const t0  = Date.now();
    const res = await fetchWithRetry({
      model,
      max_tokens:  maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }, apiKey);

    const data = await res.json();
    const elapsed = Date.now() - t0;

    if (!res.ok) {
      const errMsg = data.error?.message || JSON.stringify(data.error) || 'Claude API error';
      console.error(`[Claude] API error (${res.status}) after ${elapsed}ms:`, errMsg);
      return { text: '', error: errMsg };
    }

    const text = data.content?.[0]?.text || '';
    console.log(`[Claude] ${model} — ${elapsed}ms — ${text.length} chars`);
    return { text };

  } catch (e) {
    const msg = (e as Error).message;
    console.error('[Claude] Fetch error:', msg);
    return { text: '', error: msg };
  }
}

// Safe JSON parser for Claude responses — handles trailing text, backticks, etc.
export function parseClaudeJson(raw: string): Record<string, unknown> {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract the outermost JSON object
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fall through */ }
    }
    console.error('[Claude] JSON parse failed:', cleaned.slice(0, 300));
    return {};
  }
}

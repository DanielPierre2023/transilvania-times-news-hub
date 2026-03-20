const GEMINI_MODEL = 'gemini-2.5-flash';

interface GeminiRequest {
  systemInstruction: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

interface GeminiResponse {
  text: string;
  error?: string;
}

export async function callGemini({
  systemInstruction,
  userMessage,
  temperature = 0.7,
  maxTokens = 2000,
  jsonMode = false,
}: GeminiRequest): Promise<GeminiResponse> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return { text: '', error: 'GEMINI_API_KEY not configured' };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userMessage }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    const errMsg = data.error?.message || JSON.stringify(data.error) || 'Gemini API error';
    return { text: '', error: errMsg };
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { text };
}

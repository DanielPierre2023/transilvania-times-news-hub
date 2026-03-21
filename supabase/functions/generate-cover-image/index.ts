import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function buildPrompt(title: string, excerpt: string): string {
  const subject = `${title} ${excerpt}`.substring(0, 120).replace(/[^\w\s-]/g, '');
  return `Professional news photography, high-detail, editorial style, regarding: ${subject}`;
}

async function generateWithHuggingFace(prompt: string, apiKey: string): Promise<Uint8Array> {
  const providers = [
    { provider: 'fal-ai', model: 'black-forest-labs/FLUX.1-schnell' },
    { provider: 'hf-inference', model: 'black-forest-labs/FLUX.1-schnell' },
  ];

  for (const { provider, model } of providers) {
    try {
      console.log(`Trying HF provider=${provider} model=${model}`);
      const res = await fetch(`https://router.huggingface.co/${provider}/models/${model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { width: 1024, height: 576 },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`HF ${provider}/${model} failed (${res.status}): ${errText.substring(0, 200)}`);
        continue;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('image')) {
        console.error(`HF returned non-image: ${contentType}`);
        continue;
      }

      const buffer = await res.arrayBuffer();
      if (buffer.byteLength < 1000) continue;

      console.log(`HF success: ${buffer.byteLength} bytes`);
      return new Uint8Array(buffer);
    } catch (e) {
      console.error(`HF error: ${(e as Error).message}`);
      continue;
    }
  }
  throw new Error('ALL_HF_PROVIDERS_FAILED');
}

async function generateWithOpenAI(prompt: string, apiKey: string): Promise<Uint8Array> {
  console.log('Trying OpenAI DALL-E 3...');
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: '1792x1024',
      quality: 'standard',
      response_format: 'b64_json',
    }),
  });

  if (!res.ok) {
    const errData = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errData.substring(0, 200)}`);
  }

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image data');

  // Decode base64 to Uint8Array
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  console.log(`OpenAI DALL-E success: ${bytes.byteLength} bytes`);
  return bytes;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { title, excerpt } = await req.json();
    if (!title) {
      return new Response(JSON.stringify({ error: 'Title is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prompt = buildPrompt(title, excerpt || '');
    const hfKey = Deno.env.get('HUGGING_FACE_API_KEY');
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    let imageBytes: Uint8Array;
    let ext = 'jpg';

    // Provider chain: HF → OpenAI DALL-E → error
    let lastError = '';
    let success = false;

    // Try Hugging Face first (free)
    if (hfKey) {
      try {
        imageBytes = await generateWithHuggingFace(prompt, hfKey);
        success = true;
      } catch (e) {
        lastError = `HF: ${(e as Error).message}`;
        console.warn(lastError);
      }
    }

    // Fallback to OpenAI (paid but reliable)
    if (!success && openaiKey) {
      try {
        imageBytes = await generateWithOpenAI(prompt, openaiKey);
        ext = 'png';
        success = true;
      } catch (e) {
        lastError += ` | OpenAI: ${(e as Error).message}`;
        console.error(lastError);
      }
    }

    if (!success) {
      return new Response(JSON.stringify({
        error: 'IMAGE_GENERATION_FAILED',
        details: lastError || 'No image provider configured',
      }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upload to Supabase Storage
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const fileName = `covers/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('blog-images')
      .upload(fileName, imageBytes!, { contentType, upsert: false });

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    const { data: urlData } = supabaseAdmin.storage
      .from('blog-images')
      .getPublicUrl(fileName);

    console.log(`Image stored: ${urlData.publicUrl}`);

    return new Response(JSON.stringify({
      success: true,
      publicUrl: urlData.publicUrl,
      fileName,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('generate-cover-image error:', (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

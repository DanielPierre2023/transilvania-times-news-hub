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
  const models = [
    'black-forest-labs/FLUX.1-schnell',
    'stabilityai/stable-diffusion-xl-base-1.0',
  ];

  for (const model of models) {
    try {
      console.log(`Trying HF model: ${model}`);
      const res = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { width: 1200, height: 630 },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`HF ${model} failed (${res.status}): ${errText}`);
        // If model is loading, try next
        if (res.status === 503 || res.status === 429) continue;
        continue;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('image')) {
        console.error(`HF ${model} returned non-image: ${contentType}`);
        continue;
      }

      const buffer = await res.arrayBuffer();
      if (buffer.byteLength < 1000) {
        console.error(`HF ${model} returned tiny response: ${buffer.byteLength} bytes`);
        continue;
      }

      console.log(`HF ${model} success: ${buffer.byteLength} bytes`);
      return new Uint8Array(buffer);
    } catch (e) {
      console.error(`HF ${model} error: ${(e as Error).message}`);
      continue;
    }
  }

  throw new Error('ALL_HF_MODELS_FAILED');
}

async function generateWithPollinations(prompt: string): Promise<Uint8Array> {
  const seed = Math.floor(Math.random() * 100000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1200&height=630&model=flux&seed=${seed}&nologo=true`;
  
  console.log(`Trying Pollinations fallback...`);
  const res = await fetch(url, { redirect: 'follow' });
  
  if (!res.ok) throw new Error(`Pollinations ${res.status}`);
  
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('image')) {
    throw new Error(`Pollinations returned non-image: ${contentType}`);
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < 1000) throw new Error('Pollinations returned empty image');
  
  console.log(`Pollinations success: ${buffer.byteLength} bytes`);
  return new Uint8Array(buffer);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { title, excerpt, seed } = await req.json();
    if (!title) {
      return new Response(JSON.stringify({ error: 'Title is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prompt = buildPrompt(title, excerpt || '');
    const hfKey = Deno.env.get('HUGGING_FACE_API_KEY');
    let imageBytes: Uint8Array;

    // Try Hugging Face first, then Pollinations fallback
    try {
      if (!hfKey) throw new Error('NO_HF_KEY');
      imageBytes = await generateWithHuggingFace(prompt, hfKey);
    } catch (hfErr) {
      console.warn(`HF failed: ${(hfErr as Error).message}, trying Pollinations...`);
      try {
        imageBytes = await generateWithPollinations(prompt);
      } catch (pollErr) {
        console.error(`All providers failed. HF: ${(hfErr as Error).message}, Pollinations: ${(pollErr as Error).message}`);
        return new Response(JSON.stringify({
          error: 'IMAGE_GENERATION_FAILED',
          details: `HF: ${(hfErr as Error).message}, Pollinations: ${(pollErr as Error).message}`,
        }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Upload to Supabase Storage
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const fileName = `covers/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('blog-images')
      .upload(fileName, imageBytes, {
        contentType: 'image/jpeg',
        upsert: false,
      });

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

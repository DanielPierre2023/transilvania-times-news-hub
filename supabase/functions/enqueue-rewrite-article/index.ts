import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { article_id, editor = 'marcus_webb' } = await req.json();

    if (!article_id) {
      return new Response(JSON.stringify({ ok: false, code: 'MISSING_ARTICLE_ID', message: 'article_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: article, error: fetchErr } = await supabaseAdmin
      .from('scraped_articles').select('id, status').eq('id', article_id).single();

    if (fetchErr || !article) {
      return new Response(JSON.stringify({ ok: false, code: 'ARTICLE_NOT_FOUND', message: 'Article not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: job, error: jobErr } = await supabaseAdmin
      .from('rewrite_jobs').insert({ article_id, editor, status: 'queued' }).select('id').single();

    if (jobErr || !job) {
      return new Response(JSON.stringify({ ok: false, code: 'JOB_CREATE_FAILED', message: jobErr?.message || 'Failed to create job' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabaseAdmin.from('scraped_articles').update({
      status: 'rewriting', last_rewrite_job_id: job.id, rewrite_error: null,
      rewrite_started_at: new Date().toISOString(), rewrite_finished_at: null,
    }).eq('id', article_id);

    const workerUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/process-rewrite-job`;
    fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
      body: JSON.stringify({ job_id: job.id }),
    }).catch(e => console.log('Worker fire-and-forget:', e?.message || 'ok'));

    return new Response(JSON.stringify({ ok: true, job_id: job.id, status: 'queued' }), {
      status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ ok: false, code: 'INTERNAL_ERROR', message: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

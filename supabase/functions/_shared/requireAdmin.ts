import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Shared authorization gate for Supabase Edge Functions.
 *
 * PREVIOUSLY every AI/email/scraper function in this project relied solely
 * on Supabase's built-in `verify_jwt` setting. That setting defaults to true,
 * but it is satisfied by ANY valid JWT — including the public anon key that
 * ships in the site's own JS bundle. No handler checked WHO the caller
 * actually was, so any visitor who copied the anon key out of the bundle
 * could trigger paid LLM calls, mass-mail the newsletter list, or re-run the
 * scraper/rewrite pipeline, in an unbounded loop, for free.
 *
 * This allows exactly two kinds of caller:
 *   1. Another trusted server component of this system, authenticating with
 *      this project's own SUPABASE_SERVICE_ROLE_KEY as its bearer token —
 *      this is how process-rewrite-job, enqueue-rewrite-article, and similar
 *      internal chains call each other today.
 *   2. A logged-in admin user, identified by a valid user JWT whose subject
 *      (auth.uid()) has an 'admin' row in public.user_roles.
 *
 * Anonymous callers, and signed-in-but-non-admin callers, are rejected.
 *
 * USAGE — at the top of a function's serve() handler, right after the
 * existing OPTIONS/CORS preflight check:
 *
 *   const denied = await requireAdmin(req);
 *   if (denied) return denied;
 *
 * Returns `null` when the caller is authorized, or a ready-to-return
 * Response (401/403) when it is not.
 */
export async function requireAdmin(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey && token === serviceKey) {
    return null; // trusted internal caller
  }
  // FIX (23 Aug 2026): the exact-match above is not sufficient. pg_cron jobs and
  // internal service-to-service calls send a service-role JWT that was hard-coded
  // into the caller (a cron job command, an env var, a config row). When the
  // project's service-role key is rotated or migrated to the new key format, that
  // hard-coded token stops matching SUPABASE_SERVICE_ROLE_KEY, execution falls
  // through to the user-JWT branch below, and every internal call returns 401.
  // weather-alert failed exactly this way on 12 consecutive cron runs (22-23 Aug
  // 2026) while still booting normally - the cron job itself reported "succeeded".
  // So also accept a token that PROVES it is service-role by performing an
  // operation only service-role may perform. GoTrue verifies the signature, so a
  // forged token or the public anon key still cannot pass this.
  try {
    const { createClient: _cc } = await import("https://esm.sh/@supabase/supabase-js@2");
    const _probe = _cc(Deno.env.get('SUPABASE_URL')!, token, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: _svcErr } = await _probe.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (!_svcErr) return null;
  } catch (_e) { /* not a service-role token - fall through to the admin-user check */ }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    // SUPABASE_ANON_KEY is auto-injected by the Supabase platform into every
    // edge function's environment, same as SUPABASE_URL and
    // SUPABASE_SERVICE_ROLE_KEY — no separate secret to configure.
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabase = createClient(supabaseUrl, anonKey ?? serviceKey!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Relies on the "Users can read own role" RLS policy on user_roles
    // (USING (user_id = auth.uid())) — the client above carries the caller's
    // own JWT, so this can only ever read the CALLER's own role row.
    const { data: roleRow, error: roleErr } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleErr || !roleRow) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return null; // caller is an authenticated admin
  } catch (e) {
    // Fail closed: any error in the check itself is treated as "could not
    // verify" and denied, never silently allowed through.
    console.error('[requireAdmin] check failed, denying by default:', (e as Error).message);
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

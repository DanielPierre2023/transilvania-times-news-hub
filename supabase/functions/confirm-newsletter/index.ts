import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import brandedEmailTemplate from "../_shared/brandedEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE = "https://transilvaniatimes.com";

const tpl = {
  en: {
    subject: "Welcome to Transilvania Times Newsletter! 📰",
    heading: "You're in — welcome aboard!",
    body: `<p>Thank you for subscribing to the Transilvania Times newsletter.</p>
<p>Here's what you can look forward to:</p>
<p><strong>Technology & AI</strong> — deep dives into the latest developments<br/>
<strong>Politics & World</strong> — analysis from a Central European perspective<br/>
<strong>Culture & Business</strong> — stories that matter from Transylvania and beyond</p>
<p>We send curated content once or twice a month — no spam, ever.</p>
<p>Welcome to the community,<br/>The Transilvania Times Team</p>`,
    ctaText: "Visit Our Blog",
    ctaUrl: `${SITE}/blog`,
  },
  ro: {
    subject: "Bine ai venit în newsletter-ul Transilvania Times! 📰",
    heading: "Te-ai abonat cu succes!",
    body: `<p>Mulțumim că te-ai abonat la newsletter-ul Transilvania Times.</p>
<p>Ce vei primi de la noi:</p>
<p><strong>Tehnologie & AI</strong> — analize tehnice aprofundate<br/>
<strong>Politică & Lume</strong> — perspectivă din Europa Centrală<br/>
<strong>Cultură & Business</strong> — povești care contează din Transilvania și din lume</p>
<p>Trimitem conținut selectat o dată sau de două ori pe lună — fără spam, garantat.</p>
<p>Bine ai venit în comunitate,<br/>Echipa Transilvania Times</p>`,
    ctaText: "Vizitează blogul",
    ctaUrl: `${SITE}/blog`,
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, language } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "Email required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const lang = language === "ro" ? "ro" : "en";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await supabase.from("contacts").upsert(
      { email, source: "newsletter", language: lang, newsletter_subscribed: true },
      { onConflict: "email" }
    );

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const resend = new Resend(resendKey);
      const t = tpl[lang];
      await resend.emails.send({
        from: "Transilvania Times <noreply@transilvaniatimes.com>",
        reply_to: "contact@transilvaniatimes.com",
        to: [email],
        subject: t.subject,
        html: brandedEmailTemplate({
          language: lang, heading: t.heading, bodyHtml: t.body, ctaText: t.ctaText, ctaUrl: t.ctaUrl,
        }),
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

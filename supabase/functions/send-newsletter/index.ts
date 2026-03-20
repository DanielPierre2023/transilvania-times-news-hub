import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import brandedEmailTemplate from "../_shared/brandedEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE = "https://transilvaniatimes.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { campaignId } = await req.json();
    if (!campaignId) {
      return new Response(JSON.stringify({ error: "campaignId required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: campaign, error: cErr } = await supabase.from("newsletter_campaigns").select("*").eq("id", campaignId).single();
    if (cErr || !campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    let contactQuery = supabase.from("contacts").select("email, name, language").eq("newsletter_subscribed", true);
    if (campaign.target_language && campaign.target_language !== "all") {
      contactQuery = contactQuery.eq("language", campaign.target_language);
    }
    const { data: contacts } = await contactQuery;

    let subQuery = supabase.from("newsletter_subscribers").select("email, name, language").eq("is_active", true);
    if (campaign.target_language && campaign.target_language !== "all") {
      subQuery = subQuery.eq("language", campaign.target_language);
    }
    const { data: subscribers } = await subQuery;

    const emailMap = new Map();
    for (const c of contacts || []) emailMap.set(c.email.toLowerCase(), { email: c.email, name: c.name, language: c.language || "en" });
    for (const s of subscribers || []) { const key = s.email.toLowerCase(); if (!emailMap.has(key)) emailMap.set(key, { email: s.email, name: s.name, language: s.language || "en" }); }
    const recipients = Array.from(emailMap.values());

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ error: "No subscribers found" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const resend = new Resend(resendKey);
    let sentCount = 0;
    const errors: string[] = [];

    const footerByLang: Record<string, string> = {
      en: `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888;">
        <p>You're receiving this because you subscribed to the Transilvania Times newsletter.</p>
        <p><a href="${SITE}/blog" style="color:#1a1a2e;">Visit our blog →</a></p>
        <p>To unsubscribe, reply with "unsubscribe" in the subject line.</p></div>`,
      ro: `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888;">
        <p>Primești acest email pentru că te-ai abonat la newsletter-ul Transilvania Times.</p>
        <p><a href="${SITE}/blog" style="color:#1a1a2e;">Vizitează blogul →</a></p>
        <p>Pentru dezabonare, răspunde cu „dezabonare" în subiect.</p></div>`,
    };

    const batchSize = 10;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      const promises = batch.map(async (contact) => {
        try {
          const lang = (contact.language === "ro" ? "ro" : "en") as "en" | "ro";
          await resend.emails.send({
            from: "Transilvania Times <noreply@transilvaniatimes.com>",
            reply_to: "contact@transilvaniatimes.com",
            to: [contact.email],
            subject: campaign.subject,
            html: brandedEmailTemplate({
              language: lang,
              heading: campaign.subject,
              bodyHtml: (campaign.content || '') + footerByLang[lang],
            }),
          });
          sentCount++;
        } catch (e) {
          console.error(`Failed to send to ${contact.email}:`, e);
          errors.push(contact.email);
        }
      });
      await Promise.all(promises);
    }

    await supabase.from("newsletter_campaigns").update({
      status: "sent", sent_at: new Date().toISOString(), recipient_count: sentCount,
    }).eq("id", campaignId);

    return new Response(JSON.stringify({ success: true, sentCount, errors }), {
      status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

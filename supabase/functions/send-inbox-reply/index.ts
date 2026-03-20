import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
    const { messageId, replyText } = await req.json();
    if (!messageId || !replyText) {
      return new Response(JSON.stringify({ error: "messageId and replyText required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: msg, error: mErr } = await supabase.from("contact_messages").select("*").eq("id", messageId).single();

    if (mErr || !msg) {
      return new Response(JSON.stringify({ error: "Message not found" }), {
        status: 404, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const resend = new Resend(resendKey);
    const firstName = (msg.name || 'Reader').split(" ")[0];

    await resend.emails.send({
      from: "Transilvania Times <noreply@transilvaniatimes.com>",
      reply_to: "contact@transilvaniatimes.com",
      to: [msg.email],
      subject: `Re: ${msg.subject || "Your message to Transilvania Times"}`,
      html: brandedEmailTemplate({
        language: "en",
        heading: "Reply from our team",
        bodyHtml: `
          <p>Hi ${firstName},</p>
          <p>Thank you for your patience. Here is our response to your inquiry:</p>
          <blockquote style="border-left:3px solid #ca2222;padding-left:16px;margin:16px 0;color:#555;">
            ${replyText.replace(/\n/g, "<br/>")}
          </blockquote>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
          <p style="font-size:13px;color:#888;">Your original message</p>
          <blockquote style="border-left:3px solid #ddd;padding-left:16px;margin:8px 0;color:#888;font-size:13px;">
            ${msg.message.replace(/\n/g, "<br/>")}
          </blockquote>
          <p>If you have any follow-up questions, simply reply to this email.</p>
          <p>Warm regards,<br/>The Transilvania Times Team</p>`,
        ctaText: "Visit our website",
        ctaUrl: SITE,
      }),
    });

    await supabase.from("contact_messages").update({
      admin_reply: replyText, replied_at: new Date().toISOString(), status: "replied",
    }).eq("id", messageId);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

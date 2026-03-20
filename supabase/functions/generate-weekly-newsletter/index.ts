import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { sanitizeContent } from "../_shared/sanitize.ts";
import brandedEmailTemplate from "../_shared/brandedEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE = "https://transilvaniatimes.com";

function stripCodeFences(text: string): string {
  let result = text.trim();
  result = result.replace(/^```html\s*/i, "");
  result = result.replace(/^```\w*\s*/i, "");
  result = result.replace(/```\s*$/i, "");
  return result.trim();
}

const FOOTER_EN = `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888;">
<p>You're receiving this because you subscribed to the Transilvania Times newsletter.</p>
<p><a href="${SITE}/blog" style="color:#1a1a2e;">Visit our blog →</a></p>
<p>To unsubscribe, reply with "unsubscribe" in the subject line.</p></div>`;

const FOOTER_RO = `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888;">
<p>Primești acest email pentru că te-ai abonat la newsletter-ul Transilvania Times.</p>
<p><a href="${SITE}/blog" style="color:#1a1a2e;">Vizitează blogul →</a></p>
<p>Pentru dezabonare, răspunde cu „dezabonare" în subiect.</p></div>`;

function buildSystemPrompt(lang: "en" | "ro", articles: any[]): string {
  const isRo = lang === "ro";
  const articleSummaries = articles.map((a, i) => {
    const title = isRo ? a.title_ro || a.title_en : a.title_en;
    const excerpt = isRo ? a.excerpt_ro || a.excerpt_en : a.excerpt_en || "";
    const content = isRo ? a.content_ro || a.content_en : a.content_en;
    const preview = content?.substring(0, 800) || "";
    return `Article ${i + 1}: "${title}"\nCategory: ${a.category || "technology"}\nTags: ${(a.tags || []).join(", ")}\nExcerpt: ${excerpt}\nContent preview: ${preview}`;
  }).join("\n\n");

  const langRules = isRo
    ? `Write in Romanian as a native Romanian journalist would. NOT translated from English.\nNEVER use: "esențial", "robust", "în concluzie", "peisajul", "iată", "desigur", "fără îndoială".`
    : `Write in English. Avoid generic AI phrases.`;

  return `Current date: March 2026.

You are a senior journalist writing a weekly newsletter digest for Transilvania Times.

Your task: Write a 1000-1500 word newsletter in HTML format analyzing this week's published articles.

${langRules}

CRITICAL RULES:
- Output ONLY raw HTML. No markdown code fences.
- Use inline CSS for email-safe styling.
- Use <h2> for section headings, <p> for paragraphs.
- Do NOT include signature, footer, contact info.
- Word count: 1000-1500 words.

ARTICLES TO ANALYZE:
${articleSummaries}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: articles } = await supabase.from("blog_posts")
      .select("title_en, title_ro, content_en, content_ro, excerpt_en, excerpt_ro, category, tags")
      .eq("status", "published").gte("published_at", weekAgo).order("published_at", { ascending: false });

    const posts = articles || [];
    const apiKey = Deno.env.get("OPENAI_API_KEY")!;
    const results: Record<string, string> = {};

    for (const lang of ["en", "ro"] as const) {
      const systemPrompt = buildSystemPrompt(lang, posts);
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: posts.length > 0 ? `Write the weekly digest analyzing these ${posts.length} articles.` : `Write a weekly AI digest covering significant developments of this week.` },
          ],
          temperature: 0.7,
          max_tokens: 4000,
        }),
      });
      const data = await res.json();
      if (!res.ok) { console.error(`OpenAI error ${lang}:`, data.error); continue; }
      results[lang] = stripCodeFences(data.choices?.[0]?.message?.content || "");
    }

    // Merge recipients
    const { data: contacts } = await supabase.from("contacts").select("email, name, language").eq("newsletter_subscribed", true);
    const { data: subscribers } = await supabase.from("newsletter_subscribers").select("email, name, language").eq("is_active", true);

    const emailMap = new Map();
    for (const c of contacts || []) emailMap.set(c.email.toLowerCase(), { email: c.email, name: c.name, language: c.language || "en" });
    for (const s of subscribers || []) { const key = s.email.toLowerCase(); if (!emailMap.has(key)) emailMap.set(key, { email: s.email, name: s.name, language: s.language || "en" }); }
    const recipients = Array.from(emailMap.values());

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ error: "No subscribers found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const weekLabel = `${now.getFullYear()}-W${Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))}`;
    const subjectEn = `Transilvania Times Weekly Digest – ${weekLabel}`;
    const subjectRo = `Transilvania Times Digest Săptămânal – ${weekLabel}`;

    const resend = new Resend(resendKey);
    let sentCount = 0;
    const errors: string[] = [];

    const batchSize = 10;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      const promises = batch.map(async (contact) => {
        try {
          const lang = contact.language === "ro" ? "ro" : "en";
          const contentHtml = results[lang] || results["en"] || "";
          const subject = lang === "ro" ? subjectRo : subjectEn;
          const footer = lang === "ro" ? FOOTER_RO : FOOTER_EN;
          await resend.emails.send({
            from: "Transilvania Times <noreply@transilvaniatimes.com>",
            reply_to: "contact@transilvaniatimes.com",
            to: [contact.email],
            subject,
            html: brandedEmailTemplate({
              language: lang as "en" | "ro",
              heading: subject,
              bodyHtml: contentHtml + footer,
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

    for (const lang of ["en", "ro"] as const) {
      if (results[lang]) {
        await supabase.from("newsletter_campaigns").insert({
          subject: lang === "ro" ? subjectRo : subjectEn,
          content: results[lang],
          target_language: lang,
          status: "sent",
          sent_at: new Date().toISOString(),
          recipient_count: sentCount,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, sentCount, errors, recipientCount: recipients.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

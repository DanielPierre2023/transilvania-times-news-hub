import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const Newsletter = () => {
  const [email, setEmail] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const { t, i18n } = useTranslation();

  const handleSubscribe = async () => {
    if (!email || !email.includes("@")) return;
    setSubscribing(true);
    try {
      const lang = i18n.language.startsWith("ro") ? "ro" : "en";
      const { error } = await supabase.functions.invoke("confirm-newsletter", {
        body: { email: email.trim(), language: lang },
      });
      if (error) throw error;
      toast.success(t("newsletter_success") || "Subscribed successfully!");
      setEmail("");
    } catch (err: any) {
      toast.error(err.message || "Subscription failed");
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <section className="bg-foreground py-16 px-4">
      <div className="container mx-auto max-w-xl text-center">
        <h2 className="text-3xl font-serif font-bold text-background mb-3">{t("newsletter_title")}</h2>
        <p className="text-background/60 font-sans text-sm mb-8">
          {t("newsletter_desc")}
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder={t("newsletter_placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 px-4 py-3 bg-background text-foreground font-sans text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={handleSubscribe}
            disabled={subscribing || !email}
            className="bg-primary text-primary-foreground px-8 py-3 font-sans font-bold text-sm hover:bg-accent transition-colors disabled:opacity-50"
          >
            {subscribing ? "..." : t("newsletter_button")}
          </button>
        </div>
      </div>
    </section>
  );
};

export default Newsletter;

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
    <section className="bg-primary text-primary-foreground p-12 md:p-20 border-b border-foreground/10 flex flex-col items-center text-center">
      <div className="max-w-xl">
        <h3 className="font-serif text-4xl md:text-5xl font-bold italic mb-4">
          {t("newsletter_title")}
        </h3>
        <p className="text-primary-foreground/80 font-sans mb-8">
          {t("newsletter_desc")}
        </p>
        <div className="flex flex-col md:flex-row w-full gap-0 shadow-2xl overflow-hidden">
          <input
            type="email"
            placeholder={t("newsletter_placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-grow p-5 bg-primary-foreground/10 border border-primary-foreground/30 text-primary-foreground placeholder:text-primary-foreground/50 focus:outline-none focus:bg-primary-foreground/20 font-sans"
          />
          <button
            onClick={handleSubscribe}
            disabled={subscribing || !email}
            className="bg-background text-primary px-10 py-5 font-bold uppercase text-[10px] tracking-[0.2em] hover:bg-foreground hover:text-background transition-all disabled:opacity-50"
          >
            {subscribing ? "..." : t("newsletter_button")}
          </button>
        </div>
      </div>
    </section>
  );
};

export default Newsletter;

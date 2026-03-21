import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MapPin, Mail, Phone, Facebook, Twitter, Instagram, Github } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { NAV_CATEGORIES } from "@/lib/categories";

const Footer = () => {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState("");
  const [subscribing, setSubscribing] = useState(false);

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
    <footer className="bg-background border-t border-foreground/10 pt-12 pb-6 px-4">
      <div className="container mx-auto max-w-6xl">
        {/* Brand header */}
        <div className="mb-8">
          <h2 className="text-2xl font-serif font-bold text-primary italic tracking-tight">
            Transilvania Times
          </h2>
          <p className="text-[10px] text-foreground/50 font-sans uppercase tracking-[0.15em] mt-1">
            {t("footer_company_line")}
          </p>
          <div className="w-full h-px bg-primary/30 mt-4" />
        </div>

        {/* 4-column grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {/* Popular Categories */}
          <div>
            <h4 className="font-serif font-bold text-primary text-lg mb-4">
              {t("popular_categories")}
            </h4>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-sans text-sm">
              {NAV_CATEGORIES.map(({ slug, i18nKey }) => (
                <li key={slug}>
                  <Link
                    to={`/category/${slug}`}
                    className="text-foreground/80 hover:text-primary transition-colors"
                  >
                    {t(i18nKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

        {/* Contact Us */}
          <div>
            <h4 className="font-serif font-bold text-primary text-lg mb-4">
              {t("contact_us")}
            </h4>
            <div className="space-y-3 font-sans text-sm text-foreground/80">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold text-foreground/90">{t("footer_editorial_desk")}</p>
                  <p>str. Memorandumului nr 2</p>
                  <p>Cluj-Napoca, Transilvania</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold text-foreground/90">{t("footer_corporate_hq")}</p>
                  <p>Sunset Valley, 7081 Pyla</p>
                  <p>Cyprus</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary shrink-0" />
                <a href="mailto:contact@add-individual-solutions.com" className="hover:text-primary transition-colors">
                  contact@add-individual-solutions.com
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-primary shrink-0" />
                <span>+357 96 919 606</span>
              </div>
            </div>
          </div>

          {/* Accessibility */}
          <div>
            <h4 className="font-serif font-bold text-primary text-lg mb-4">
              {t("footer_accessibility")}
            </h4>
            <ul className="space-y-1.5 font-sans text-sm">
              <li>
                <Link to="/contact" className="text-foreground/80 hover:text-primary transition-colors">
                  {t("contact_us")}
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-foreground/80 hover:text-primary transition-colors">
                  {t("privacy_policy")}
                </Link>
              </li>
              <li>
                <Link to="/terms" className="text-foreground/80 hover:text-primary transition-colors">
                  {t("terms_conditions")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Newsletter */}
          <div>
            <div className="bg-primary rounded-sm p-5">
              <h4 className="font-serif font-bold text-primary-foreground text-lg mb-2">
                {t("newsletter_title")}
              </h4>
              <p className="text-primary-foreground/80 font-sans text-xs mb-4">
                {t("newsletter_desc")}
              </p>
              <div className="flex flex-col gap-2">
                <input
                  type="email"
                  placeholder={t("newsletter_placeholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-sm bg-background text-foreground font-sans text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  onClick={handleSubscribe}
                  disabled={subscribing || !email}
                  className="w-full bg-primary-foreground text-primary px-4 py-2 font-sans font-bold text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
                >
                  {subscribing ? "..." : t("newsletter_button")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-primary/30 pt-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs font-sans text-foreground/50">
            <p>{t("copyright")}</p>
            <p className="mt-0.5">VAT: CY10439793M</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="#" aria-label="Facebook" className="text-foreground/50 hover:text-primary transition-colors">
              <Facebook className="w-4 h-4" />
            </a>
            <a href="#" aria-label="Twitter" className="text-foreground/50 hover:text-primary transition-colors">
              <Twitter className="w-4 h-4" />
            </a>
            <a href="#" aria-label="Instagram" className="text-foreground/50 hover:text-primary transition-colors">
              <Instagram className="w-4 h-4" />
            </a>
            <a href="#" aria-label="GitHub" className="text-foreground/50 hover:text-primary transition-colors">
              <Github className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

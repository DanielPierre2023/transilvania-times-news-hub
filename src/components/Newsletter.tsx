import { useState } from "react";
import { useTranslation } from "react-i18next";

const Newsletter = () => {
  const [email, setEmail] = useState("");
  const { t } = useTranslation();

  return (
    <section className="bg-foreground py-12 px-4">
      <div className="container mx-auto max-w-xl text-center">
        <h2 className="text-2xl font-serif font-bold text-background mb-2">{t("newsletter_title")}</h2>
        <p className="text-background/70 font-sans text-sm mb-6">
          {t("newsletter_desc")}
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder={t("newsletter_placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 px-4 py-2.5 rounded bg-background text-foreground font-sans text-sm placeholder:text-clay focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button className="bg-primary text-primary-foreground px-6 py-2.5 font-sans font-semibold text-sm rounded hover:bg-action-orange transition-colors">
            {t("newsletter_button")}
          </button>
        </div>
      </div>
    </section>
  );
};

export default Newsletter;

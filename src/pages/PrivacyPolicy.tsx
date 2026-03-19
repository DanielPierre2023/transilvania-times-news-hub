import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "@/components/Header";
import Newsletter from "@/components/Newsletter";
import Footer from "@/components/Footer";

const sectionKeys = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] as const;

const PrivacyPolicy = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-4xl mx-auto px-5 py-16">
        <header className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 bg-primary" />
            <span className="text-primary font-sans font-bold text-[10px] uppercase tracking-[0.2em]">
              {t("privacy_legal_label")}
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground leading-tight italic tracking-tighter">
            {t("privacy_title")}
          </h1>
          <p className="text-muted-foreground font-sans text-sm mt-4">
            {t("privacy_updated")}
          </p>
        </header>

        <div className="space-y-10 font-sans text-foreground/90 text-lg leading-relaxed">
          {sectionKeys.map((key) => (
            <section key={key}>
              <h2 className="text-xl font-serif font-bold text-foreground mb-3">
                {t(`privacy_${key}_title`)}
              </h2>
              <p>{t(`privacy_${key}_body`)}</p>
            </section>
          ))}

          <section className="border-t border-foreground/10 pt-10">
            <h2 className="text-xl font-serif font-bold text-foreground mb-3">
              {t("privacy_contact_title")}
            </h2>
            <div className="text-base space-y-1">
              <p className="font-bold">{t("terms_hq")}</p>
              <p>str. Memorandumului nr 2</p>
              <p>Cluj-Napoca, Transilvania</p>
              <p className="mt-3">
                Email:{" "}
                <a
                  href="mailto:privacy@transilvaniatimes.com"
                  className="text-primary hover:underline"
                >
                  privacy@transilvaniatimes.com
                </a>
              </p>
            </div>
          </section>
        </div>

        <div className="mt-16 flex justify-center md:justify-start">
          <Link
            to="/"
            className="bg-primary text-primary-foreground px-10 py-4 font-bold uppercase tracking-tight hover:bg-accent transition-all"
          >
            {t("privacy_back")}
          </Link>
        </div>
      </main>

      <Newsletter />
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const categoryKeys = [
  "cat_politics", "cat_technology", "cat_education", "cat_sports",
  "cat_showbiz", "cat_health", "cat_beauty", "cat_travel",
] as const;

const categorySlugs: Record<string, string> = {
  cat_politics: "politics",
  cat_technology: "technology",
  cat_education: "education",
  cat_sports: "sports",
  cat_showbiz: "showbiz",
  cat_health: "health",
  cat_beauty: "beauty",
  cat_travel: "travel",
};

const Footer = () => {
  const { t } = useTranslation();

  return (
    <footer className="bg-foreground text-background/80 py-12 px-4">
      <div className="container mx-auto max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {/* Brand */}
          <div>
            <h3 className="text-xl font-serif font-bold text-background mb-3">Transilvania Times</h3>
            <p className="text-sm font-sans leading-relaxed text-background/60">
              {t("footer_description")}
            </p>
          </div>

          {/* Categories */}
          <div>
            <h4 className="font-sans font-semibold text-background mb-3 text-sm uppercase tracking-wider">
              {t("popular_categories")}
            </h4>
            <ul className="space-y-1.5 font-sans text-sm">
              {categoryKeys.map((key) => (
                <li key={key}>
                  <Link to={`/category/${categorySlugs[key]}`} className="hover:text-background transition-colors">
                    {t(key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-sans font-semibold text-background mb-3 text-sm uppercase tracking-wider">
              {t("contact_us")}
            </h4>
            <div className="space-y-1.5 font-sans text-sm">
              <p>str. Memorandumului nr 2</p>
              <p>Cluj-Napoca, Transilvania</p>
              <p className="mt-3">
                <a href="mailto:needhelp@transilvaniatimes.com" className="hover:text-background transition-colors">
                  needhelp@transilvaniatimes.com
                </a>
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-background/20 mt-10 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs font-sans text-background/50">
            {t("copyright")}
          </p>
          <div className="flex gap-6 text-xs font-sans">
            <Link to="/contact" className="hover:text-background transition-colors">{t("contact_us")}</Link>
            <Link to="/privacy" className="hover:text-background transition-colors">{t("privacy_policy")}</Link>
            <Link to="/terms" className="hover:text-background transition-colors">{t("terms_conditions")}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

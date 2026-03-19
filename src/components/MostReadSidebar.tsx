import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { articles, t as tBi } from "@/data/articles";

const trending = articles.slice(0, 4);

const MostReadSidebar = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  return (
    <aside className="w-full bg-background/30 p-6 border border-foreground/5 shadow-sm">
      <h3 className="text-xl font-serif font-bold text-foreground border-b-2 border-primary pb-3 mb-2 uppercase tracking-tighter italic">
        {t("most_read")}
      </h3>
      <div className="flex flex-col">
        {trending.map((article, i) => (
          <Link
            key={article.slug}
            to={`/article/${article.slug}`}
            className="flex gap-4 group cursor-pointer py-5 border-b border-foreground/10 last:border-0"
          >
            <span className="text-3xl font-serif font-bold text-foreground/20 group-hover:text-primary transition-colors">
              0{i + 1}
            </span>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-primary" />
                <span className="text-primary font-sans font-bold text-[9px] uppercase tracking-widest">
                  {tBi(article.category, lang)}
                </span>
              </div>
              <h4 className="text-base font-serif font-bold text-foreground leading-tight group-hover:text-accent transition-colors">
                {tBi(article.title, lang)}
              </h4>
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-tighter italic">
                {tBi(article.timeAgo, lang)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </aside>
  );
};

export default MostReadSidebar;

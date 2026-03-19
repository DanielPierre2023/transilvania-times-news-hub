import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getArticleBySlug, t as tBi, tArr } from "@/data/articles";
import Header from "@/components/Header";

import Footer from "@/components/Footer";
import MostReadSidebar from "@/components/MostReadSidebar";
import ArticleSEO from "@/components/ArticleSEO";
import AdUnit from "@/components/AdUnit";
import NotFound from "./NotFound";

const Article = () => {
  const { slug } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const article = slug ? getArticleBySlug(slug) : undefined;

  if (!article) return <NotFound />;

  const body = tArr(article.body, lang);
  const midPoint = Math.floor(body.length / 2);
  const firstHalf = body.slice(0, midPoint);
  const secondHalf = body.slice(midPoint);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <ArticleSEO article={article} />

      {/* Top Leaderboard */}
      <AdUnit type="leaderboard" className="pt-4" />

      <div className="max-w-6xl mx-auto px-4 py-12 grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Main Article Column */}
        <div className="lg:col-span-8">
          <header className="text-center md:text-left">
            <div className="flex items-center gap-2 mb-4 justify-center md:justify-start">
              <div className="w-2 h-2 bg-primary" />
              <span className="text-primary font-sans font-bold text-xs uppercase tracking-widest">
                {tBi(article.category, lang)}
              </span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-bold text-foreground leading-[1.1] mb-6">
              {tBi(article.title, lang)}
            </h1>

            <div className="flex flex-col md:flex-row justify-between items-center py-4 border-b border-foreground/10">
              <p className="text-muted-foreground font-sans text-lg">{tBi(article.date, lang)}</p>
              <p className="text-foreground font-sans font-bold text-lg">{t("by_author")} {article.author}</p>
            </div>
          </header>

          <section className="py-10">
            <img
              src={article.image}
              alt={tBi(article.title, lang)}
              className="w-full aspect-[2/1] object-cover shadow-2xl rounded-sm"
            />
          </section>

          <main className="pb-20 font-sans text-foreground text-lg leading-relaxed space-y-8">
            {firstHalf.map((paragraph, i) => {
              const subheading = article.subheadings?.find((s) => s.index === i);
              return (
                <div key={i}>
                  {subheading && (
                    <h2 className="text-2xl font-serif font-bold pt-4 uppercase">
                      {tBi(subheading.title, lang)}
                    </h2>
                  )}
                  <p>{paragraph}</p>
                </div>
              );
            })}

            {/* Mid-article in-feed ad */}
            <AdUnit type="infeed" />

            {secondHalf.map((paragraph, i) => {
              const actualIndex = midPoint + i;
              const subheading = article.subheadings?.find((s) => s.index === actualIndex);
              return (
                <div key={actualIndex}>
                  {subheading && (
                    <h2 className="text-2xl font-serif font-bold pt-4 uppercase">
                      {tBi(subheading.title, lang)}
                    </h2>
                  )}
                  <p>{paragraph}</p>
                </div>
              );
            })}

            <div className="pt-12 flex justify-center md:justify-start">
              <Link
                to="/"
                className="bg-primary text-primary-foreground px-10 py-4 font-bold uppercase tracking-tight hover:bg-accent transition-all"
              >
                {t("go_back")}
              </Link>
            </div>
          </main>
        </div>

        {/* Sidebar Column */}
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-32 space-y-12">
            <MostReadSidebar />
            <AdUnit type="sidebar" />
          </div>
        </div>
      </div>

      
      <Footer />
    </div>
  );
};

export default Article;

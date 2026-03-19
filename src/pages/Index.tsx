import { useTranslation } from "react-i18next";
import Header from "@/components/Header";
import ArticleCard from "@/components/ArticleCard";

import Footer from "@/components/Footer";
import AdUnit from "@/components/AdUnit";
import { featuredArticle, articles, t as tBi } from "@/data/articles";

const Index = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto max-w-6xl px-4 py-8">
        <ArticleCard
          slug={featuredArticle.slug}
          category={tBi(featuredArticle.category, lang)}
          title={tBi(featuredArticle.title, lang)}
          author={featuredArticle.author}
          timeAgo={tBi(featuredArticle.timeAgo, lang)}
          excerpt={tBi(featuredArticle.excerpt, lang)}
          image={featuredArticle.image}
          featured
        />

        {/* Leaderboard ad above latest stories */}
        <AdUnit type="leaderboard" />

        <div className="mt-10 border-t border-foreground/20 pt-8">
          <h2 className="text-xl font-serif font-bold text-foreground mb-6">{t("latest_stories")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {articles.slice(1).map((article) => (
              <ArticleCard
                key={article.slug}
                slug={article.slug}
                category={tBi(article.category, lang)}
                title={tBi(article.title, lang)}
                author={article.author}
                timeAgo={tBi(article.timeAgo, lang)}
                excerpt={tBi(article.excerpt, lang)}
                image={article.image}
              />
            ))}
          </div>
        </div>
      </main>

      
      <Footer />
    </div>
  );
};

export default Index;

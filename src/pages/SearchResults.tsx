import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { articles, t as tBi, tArr } from "@/data/articles";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

import ArticleCard from "@/components/ArticleCard";
import MostReadSidebar from "@/components/MostReadSidebar";

const SearchResults = () => {
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const query = searchParams.get("q")?.toLowerCase() || "";

  const results = query
    ? articles.filter(
        (a) =>
          tBi(a.title, lang).toLowerCase().includes(query) ||
          tBi(a.category, lang).toLowerCase().includes(query) ||
          tArr(a.body, lang).some((p) => p.toLowerCase().includes(query))
      )
    : [];

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="border-b border-foreground/20 mb-12 pb-6">
          <p className="text-muted-foreground font-sans text-xs uppercase tracking-[0.2em] mb-2 font-bold">
            {t("search_results_for")}
          </p>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground italic tracking-tighter">
            "{searchParams.get("q") || ""}"
          </h1>
          <p className="text-muted-foreground font-sans text-sm mt-4 uppercase font-medium">
            {results.length} {t("articles_found")}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-8">
            {results.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-12">
                {results.map((a) => (
                  <ArticleCard
                    key={a.slug}
                    slug={a.slug}
                    category={tBi(a.category, lang)}
                    title={tBi(a.title, lang)}
                    author={a.author}
                    timeAgo={tBi(a.timeAgo, lang)}
                    excerpt={tBi(a.excerpt, lang)}
                    image={a.image}
                  />
                ))}
              </div>
            ) : (
              <div className="py-20 text-center border border-dashed border-foreground/20">
                <p className="font-serif text-2xl text-foreground/40 italic">
                  {t("no_results")}
                </p>
              </div>
            )}
          </div>

          <div className="lg:col-span-4">
            <MostReadSidebar />
          </div>
        </div>
      </div>

      
      <Footer />
    </div>
  );
};

export default SearchResults;

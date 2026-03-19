import React from "react";
import { useParams, Link } from "react-router-dom";
import { getArticlesByCategory, articles } from "@/data/articles";
import Header from "@/components/Header";
import Newsletter from "@/components/Newsletter";
import Footer from "@/components/Footer";
import AdUnit from "@/components/AdUnit";

const Category = () => {
  const { name } = useParams<{ name: string }>();
  const categoryName = name ? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() : "";
  const filtered = name ? getArticlesByCategory(name) : [];
  const displayArticles = filtered.length > 0 ? filtered : articles;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="border-b border-foreground/20 mb-10 pb-4">
          <h1 className="text-3xl font-serif font-bold text-foreground uppercase tracking-tight">
            {categoryName || "All Articles"}
          </h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {displayArticles.map((article, index) => (
            <React.Fragment key={article.slug}>
              <Link
                to={`/article/${article.slug}`}
                className="flex flex-col group cursor-pointer"
              >
                <div className="overflow-hidden mb-4 border border-foreground/5">
                  <img
                    src={article.image}
                    alt={article.title}
                    className="w-full aspect-[3/2] object-cover grayscale group-hover:grayscale-0 transition-all duration-700 ease-in-out transform group-hover:scale-105"
                  />
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 bg-primary" />
                  <span className="text-primary font-sans font-bold text-[10px] uppercase tracking-[0.1em]">
                    {article.category}
                  </span>
                </div>

                <h3 className="text-lg font-serif font-bold text-foreground leading-tight mb-3 group-hover:text-primary transition-colors duration-300">
                  {article.title}
                </h3>

                <div className="text-muted-foreground font-sans text-xs font-medium flex items-center gap-1 mt-auto">
                  <span>By {article.author}</span>
                  <span>•</span>
                  <span>{article.timeAgo}</span>
                </div>
              </Link>

              {/* Mobile in-feed ad after the 2nd card */}
              {index === 1 && (
                <div className="md:hidden">
                  <AdUnit type="infeed" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </main>

      <Newsletter />
      <Footer />
    </div>
  );
};

export default Category;

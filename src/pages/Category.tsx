import React from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getArticlesByCategory, articles, t as tBi } from "@/data/articles";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AdUnit from "@/components/AdUnit";
import { format, parseISO } from "date-fns";

const Category = () => {
  const { name } = useParams<{ name: string }>();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isRo = lang.startsWith("ro");
  const categoryName = name ? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() : "";
  const filtered = name ? getArticlesByCategory(name, lang) : [];

  // Fetch DB blog posts for this category
  const { data: dbPosts = [] } = useQuery({
    queryKey: ["category_blog_posts", name],
    queryFn: async () => {
      const { data } = await supabase
        .from("blog_posts")
        .select("*")
        .eq("status", "published")
        .eq("category", name?.toLowerCase() || "")
        .order("published_at", { ascending: false });
      return data || [];
    },
    enabled: !!name,
  });

  const displayArticles = filtered.length > 0 || dbPosts.length > 0
    ? filtered
    : articles;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="border-b border-foreground/20 mb-10 pb-4">
          <h1 className="text-3xl font-serif font-bold text-foreground uppercase tracking-tight">
            {categoryName || t("all_articles")}
          </h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Static articles */}
          {displayArticles.map((article, index) => (
            <React.Fragment key={article.slug}>
              <Link
                to={`/article/${article.slug}`}
                className="flex flex-col group cursor-pointer"
              >
                <div className="overflow-hidden mb-4 border border-foreground/5">
                  <img
                    src={article.image}
                    alt={tBi(article.title, lang)}
                    className="w-full aspect-[3/2] object-cover grayscale group-hover:grayscale-0 transition-all duration-700 ease-in-out transform group-hover:scale-105"
                  />
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 bg-primary" />
                  <span className="text-primary font-sans font-bold text-[10px] uppercase tracking-[0.1em]">
                    {tBi(article.category, lang)}
                  </span>
                </div>
                <h3 className="text-lg font-serif font-bold text-foreground leading-tight mb-3 group-hover:text-primary transition-colors duration-300">
                  {tBi(article.title, lang)}
                </h3>
                <div className="text-muted-foreground font-sans text-xs font-medium flex items-center gap-1 mt-auto">
                  <span>{t("by_author")} {article.author}</span>
                  <span>•</span>
                  <span>{tBi(article.timeAgo, lang)}</span>
                </div>
              </Link>
              {index === 1 && (
                <div className="md:hidden">
                  <AdUnit type="infeed" />
                </div>
              )}
            </React.Fragment>
          ))}

          {/* DB blog posts */}
          {dbPosts.map((post) => (
            <Link
              key={post.id}
              to={`/blog/${post.slug}`}
              className="flex flex-col group cursor-pointer"
            >
              {post.cover_image && (
                <div className="overflow-hidden mb-4 border border-foreground/5">
                  <img
                    src={post.cover_image}
                    alt={isRo ? post.title_ro || post.title_en : post.title_en}
                    className="w-full aspect-[3/2] object-cover grayscale group-hover:grayscale-0 transition-all duration-700 ease-in-out transform group-hover:scale-105"
                  />
                </div>
              )}
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 bg-primary" />
                <span className="text-primary font-sans font-bold text-[10px] uppercase tracking-[0.1em]">
                  {post.category || "news"}
                </span>
              </div>
              <h3 className="text-lg font-serif font-bold text-foreground leading-tight mb-3 group-hover:text-primary transition-colors duration-300">
                {isRo ? post.title_ro || post.title_en : post.title_en}
              </h3>
              <div className="text-muted-foreground font-sans text-xs font-medium flex items-center gap-1 mt-auto">
                {post.author_name && <span>{post.author_name}</span>}
                {post.published_at && (
                  <>
                    <span>•</span>
                    <span>{format(parseISO(post.published_at), "MMM dd, yyyy")}</span>
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Category;

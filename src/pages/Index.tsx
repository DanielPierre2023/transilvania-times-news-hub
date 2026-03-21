import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import ArticleCard from "@/components/ArticleCard";
import Footer from "@/components/Footer";
import AdUnit from "@/components/AdUnit";
import { featuredArticle, articles, t as tBi } from "@/data/articles";
import { categoryI18nKey } from "@/lib/categories";
import { toPublicMediaUrl } from "@/lib/mediaUrl";

const Index = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isRo = lang.startsWith("ro");

  const { data: latestPosts } = useQuery({
    queryKey: ["homepage_latest_posts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("blog_posts")
        .select("*")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(6);
      return data || [];
    },
  });

  const dbPosts = latestPosts || [];

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto max-w-6xl px-4 py-8">
        {/* Hero — first DB post if available, otherwise static featured */}
        {dbPosts.length > 0 ? (
          <Link to={`/blog/${dbPosts[0].slug}`} className="block">
            <article className="group cursor-pointer">
              {dbPosts[0].cover_image && (
                <div className="overflow-hidden rounded">
                  <img
                    src={toPublicMediaUrl(dbPosts[0].cover_image)}
                    alt={isRo ? dbPosts[0].title_ro || dbPosts[0].title_en : dbPosts[0].title_en}
                    className="w-full h-[400px] object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
              )}
              <div className="mt-4">
                <span className="inline-block bg-primary text-primary-foreground text-xs font-sans font-semibold px-3 py-1 rounded mb-3">
                  {t(categoryI18nKey(dbPosts[0].category || "news"))}
                </span>
                <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground leading-tight group-hover:text-primary transition-colors">
                  {isRo ? dbPosts[0].title_ro || dbPosts[0].title_en : dbPosts[0].title_en}
                </h2>
                <p className="mt-2 text-muted-foreground font-sans text-sm leading-relaxed line-clamp-3">
                  {isRo ? dbPosts[0].excerpt_ro || dbPosts[0].excerpt_en : dbPosts[0].excerpt_en}
                </p>
                <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground font-sans">
                  {dbPosts[0].author_name && (
                    <span className="font-medium">{t("by_author")} {dbPosts[0].author_name}</span>
                  )}
                  {dbPosts[0].published_at && (
                    <>
                      <span>•</span>
                      <span>{format(parseISO(dbPosts[0].published_at), "MMM dd, yyyy")}</span>
                    </>
                  )}
                </div>
              </div>
            </article>
          </Link>
        ) : (
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
        )}

        <AdUnit type="leaderboard" />

        <div className="mt-10 border-t border-foreground/20 pt-8">
          <h2 className="text-xl font-serif font-bold text-foreground mb-6">{t("latest_stories")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {dbPosts.length > 1 ? (
              dbPosts.slice(1).map((post) => (
                <Link key={post.id} to={`/blog/${post.slug}`} className="block">
                  <article className="group cursor-pointer flex gap-4">
                    {post.cover_image && (
                      <div className="overflow-hidden rounded shrink-0 w-32 h-24">
                        <img
                          src={toPublicMediaUrl(post.cover_image)}
                          alt={isRo ? post.title_ro || post.title_en : post.title_en}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      </div>
                    )}
                    <div className="flex flex-col justify-center">
                      <span className="text-xs font-sans font-semibold text-primary mb-1">
                        {t(categoryI18nKey(post.category || "news"))}
                      </span>
                      <h3 className="font-serif font-bold text-foreground text-sm leading-snug group-hover:text-primary transition-colors line-clamp-2">
                        {isRo ? post.title_ro || post.title_en : post.title_en}
                      </h3>
                      <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground font-sans">
                        {post.author_name && <span>{t("by_author")} {post.author_name}</span>}
                        {post.published_at && (
                          <>
                            <span>•</span>
                            <span>{format(parseISO(post.published_at), "MMM dd, yyyy")}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                </Link>
              ))
            ) : (
              articles.slice(1).map((article) => (
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
              ))
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Index;

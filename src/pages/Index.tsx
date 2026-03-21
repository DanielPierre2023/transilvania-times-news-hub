import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Newsletter from "@/components/Newsletter";
import AdUnit from "@/components/AdUnit";
import ArticleCard from "@/components/ArticleCard";
import MostReadSidebar from "@/components/MostReadSidebar";
import { categoryI18nKey, subcategoryI18nKey } from "@/lib/categories";
import { toPublicMediaUrl } from "@/lib/mediaUrl";

const Index = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isRo = lang.startsWith("ro");

  const { data: allPosts = [] } = useQuery({
    queryKey: ["homepage_posts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("blog_posts")
        .select("*")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(20);
      return data || [];
    },
  });

  const hero = allPosts[0] || null;
  const gridArticles = allPosts.slice(1, 5);
  const restPosts = allPosts.slice(5);

  // Group remaining posts by category
  const categoryGroups = useMemo(() => {
    const groups: Record<string, typeof restPosts> = {};
    restPosts.forEach((post) => {
      const cat = post.category || "news";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(post);
    });
    return Object.entries(groups);
  }, [restPosts]);

  const getTitle = (post: any) => isRo ? post.title_ro || post.title_en : post.title_en;
  const getExcerpt = (post: any) => isRo ? post.excerpt_ro || post.excerpt_en : post.excerpt_en;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      {/* GLOBAL AD SLOT — above main shell */}
      <div className="w-full border-b border-foreground/10 py-6">
        <AdUnit type="leaderboard" />
      </div>

      <main className="max-w-7xl mx-auto border-x border-foreground/10">

        {/* ═══ HERO + MOST READ SIDEBAR ═══ */}
        {hero ? (
          <section className="grid grid-cols-1 lg:grid-cols-12 border-b border-foreground/10">
            <div className="lg:col-span-8 p-6 lg:border-r border-foreground/10">
              <Link to={`/blog/${hero.slug}`} className="block group cursor-pointer">
                <div className="relative overflow-hidden mb-6 aspect-video border-4 border-background shadow-xl">
                  {hero.cover_image && (
                    <img
                      src={toPublicMediaUrl(hero.cover_image)}
                      alt={getTitle(hero)}
                      className="w-full h-full object-cover transition-all duration-1000 grayscale group-hover:grayscale-0"
                    />
                  )}
                  <div className="absolute top-0 left-0 bg-primary text-primary-foreground px-3 py-1 font-bold text-[10px] uppercase tracking-widest flex items-center gap-1.5">
                    {t(categoryI18nKey(hero.category || "news"))}
                    {hero.subcategory && (
                      <span className="opacity-80">· {t(subcategoryI18nKey(hero.subcategory))}</span>
                    )}
                  </div>
                </div>
                <h1 className="text-4xl md:text-7xl font-serif font-bold leading-[0.95] italic tracking-tighter mb-4 text-foreground group-hover:text-primary transition-colors">
                  {getTitle(hero)}
                </h1>
                {getExcerpt(hero) && (
                  <p className="text-muted-foreground text-lg font-sans max-w-2xl leading-relaxed">
                    {getExcerpt(hero)}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground font-sans">
                  {hero.author_name && <span className="font-medium">{t("by_author")} {hero.author_name}</span>}
                  {hero.published_at && (
                    <>
                      <span>•</span>
                      <span>{format(parseISO(hero.published_at), "MMM dd, yyyy")}</span>
                    </>
                  )}
                </div>
              </Link>
            </div>
            <aside className="lg:col-span-4 p-6 bg-primary/5">
              <MostReadSidebar />
            </aside>
          </section>
        ) : (
          <div className="p-6 text-center text-muted-foreground font-serif italic text-xl py-20">
            No articles published yet.
          </div>
        )}

        {/* ═══ LATEST NEWS — 4-COLUMN GRID ═══ */}
        {gridArticles.length > 0 && (
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 border-b border-foreground/10">
            {gridArticles.map((post, i) => (
              <ArticleCard
                key={post.id}
                slug={post.slug}
                category={post.category || "news"}
                subcategory={post.subcategory}
                title={getTitle(post)}
                timeAgo={post.published_at ? format(parseISO(post.published_at), "MMM dd, yyyy") : undefined}
                image={post.cover_image || "/placeholder.svg"}
                linkPrefix="/blog/"
                className={i < 3 ? "lg:border-r border-foreground/10" : ""}
              />
            ))}
          </section>
        )}

        {/* ═══ NEWSLETTER INTERRUPTER ═══ */}
        <Newsletter />

        {/* ═══ CATEGORY SECTIONS ═══ */}
        {categoryGroups.map(([cat, posts], groupIdx) => (
          <section key={cat} className="border-b border-foreground/10">
            {/* Category header */}
            <div className="flex items-center gap-3 px-6 pt-8 pb-4">
              <div className="w-2 h-2 bg-primary" />
              <Link
                to={`/category/${cat}`}
                className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-primary hover:underline"
              >
                {t(categoryI18nKey(cat))}
              </Link>
              <div className="flex-1 h-px bg-foreground/10" />
            </div>

            {/* 3-column grid for category sections */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 px-6 pb-6 gap-0">
              {posts.slice(0, 3).map((post, i) => (
                <ArticleCard
                  key={post.id}
                  slug={post.slug}
                  category={post.category || "news"}
                  subcategory={post.subcategory}
                  title={getTitle(post)}
                  timeAgo={post.published_at ? format(parseISO(post.published_at), "MMM dd, yyyy") : undefined}
                  image={post.cover_image || "/placeholder.svg"}
                  linkPrefix="/blog/"
                  variant="simple"
                  className={i < 2 ? "lg:border-r border-foreground/10" : ""}
                />
              ))}
            </div>

            {/* Ad unit every 2 category sections */}
            {groupIdx % 2 === 1 && groupIdx < categoryGroups.length - 1 && (
              <AdUnit type="leaderboard" />
            )}
          </section>
        ))}

        {/* ═══ VIEW ALL ═══ */}
        {allPosts.length > 0 && (
          <div className="py-10 text-center border-b border-foreground/10">
            <Link
              to="/blog"
              className="inline-block font-sans text-sm font-semibold text-primary hover:underline uppercase tracking-widest"
            >
              {t("view_all_articles")} →
            </Link>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
};

export default Index;

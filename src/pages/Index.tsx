import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
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
  const restPosts = allPosts.slice(1);

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
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-7xl mx-auto border-x border-foreground/10">
        {/* ═══ HERO + MOST READ ═══ */}
        {hero ? (
          <section className="grid grid-cols-1 lg:grid-cols-12 border-b border-foreground/10">
            <div className="lg:col-span-8 p-6 lg:border-r border-foreground/10">
              <Link to={`/blog/${hero.slug}`} className="block group">
                <div className="relative overflow-hidden border border-foreground/5">
                  {hero.cover_image && (
                    <img
                      src={toPublicMediaUrl(hero.cover_image)}
                      alt={getTitle(hero)}
                      className="w-full aspect-video object-cover grayscale group-hover:grayscale-0 transition-all duration-700 ease-in-out transform group-hover:scale-105"
                    />
                  )}
                  <div className="absolute bottom-0 left-0 bg-primary text-primary-foreground px-2.5 py-1 text-[9px] font-sans font-bold uppercase tracking-widest flex items-center gap-1.5">
                    {t(categoryI18nKey(hero.category || "news"))}
                    {(hero as any).subcategory && (
                      <span className="opacity-80">· {t(subcategoryI18nKey((hero as any).subcategory))}</span>
                    )}
                  </div>
                </div>
                <h2 className="mt-4 text-2xl md:text-3xl font-serif font-bold text-foreground leading-tight group-hover:text-primary transition-colors">
                  {getTitle(hero)}
                </h2>
                {getExcerpt(hero) && (
                  <p className="mt-2 text-muted-foreground font-sans text-sm leading-relaxed line-clamp-3">
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
            <div className="lg:col-span-4 p-6">
              <MostReadSidebar />
            </div>
          </section>
        ) : (
          <div className="p-6 text-center text-muted-foreground font-serif italic text-xl py-20">
            No articles published yet.
          </div>
        )}

        {/* ═══ AD UNIT ═══ */}
        <div className="border-b border-foreground/10">
          <AdUnit type="leaderboard" />
        </div>

        {/* ═══ CATEGORY SECTIONS ═══ */}
        {categoryGroups.map(([cat, posts], groupIdx) => (
          <section key={cat} className="border-b border-foreground/10">
            {/* Category header */}
            <div className="flex items-center gap-3 px-6 pt-8 pb-4">
              <div className="w-3 h-3 bg-primary" />
              <Link
                to={`/category/${cat}`}
                className="font-sans font-bold text-xs uppercase tracking-[0.15em] text-primary hover:underline"
              >
                {t(categoryI18nKey(cat))}
              </Link>
              <div className="flex-1 h-px bg-foreground/10" />
            </div>

            {/* 4-column newspaper grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 newspaper-grid">
              {posts.slice(0, 4).map((post) => (
                <ArticleCard
                  key={post.id}
                  slug={post.slug}
                  category={post.category || "news"}
                  subcategory={(post as any).subcategory}
                  title={getTitle(post)}
                  timeAgo={post.published_at ? format(parseISO(post.published_at), "MMM dd, yyyy") : undefined}
                  image={post.cover_image || "/placeholder.svg"}
                  linkPrefix="/blog/"
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

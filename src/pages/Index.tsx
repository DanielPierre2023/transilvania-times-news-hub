import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AdUnit from "@/components/AdUnit";
import ArticleCard from "@/components/ArticleCard";
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
        .limit(50);
      return data || [];
    },
  });

  const getTitle = (post: any) => {
    if (!post) return "";
    return isRo ? post.title_ro || post.title_en : post.title_en;
  };
  const getExcerpt = (post: any) => {
    if (!post) return "";
    return isRo ? post.excerpt_ro || post.excerpt_en : post.excerpt_en;
  };
  const getSummary = (post: any) => {
    if (!post) return "";
    return isRo ? post.summary_ro || post.summary_en : post.summary_en;
  };

  // Hero uses posts 0, 1, 2. Secondary spread uses 3, 4. Grid uses 5-8. Rest grouped by category.
  const heroMain = allPosts[0] || null;
  const heroRight = allPosts[1] || null;
  const secondaryText = allPosts[2] || null;
  const secondaryImage = allPosts[3] || null;
  const gridArticles = allPosts.slice(4, 8);
  const editorialLeftPosts = allPosts.slice(8, 14);
  const editorialCenterPosts = allPosts.slice(14, 19);
  const editorialRightPosts = allPosts.slice(19, 22);
  const restPosts = allPosts.slice(22);

  const getTimeAgo = (post: any) => {
    if (!post?.published_at) return "";
    try {
      return formatDistanceToNow(parseISO(post.published_at), { addSuffix: true });
    } catch { return ""; }
  };

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

  // Build bullet summaries from the hero article's summary
  const heroBullets = useMemo(() => {
    const summary = getSummary(heroMain);
    if (!summary) return [];
    // Split on sentences or bullet points
    const lines = summary.split(/(?:\n|(?<=\.)\s)/).filter((l: string) => l.trim().length > 10);
    return lines.slice(0, 4);
  }, [heroMain, isRo]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      {/* ═══ GLOBAL AD SLOT — above main shell ═══ */}
      <div className="w-full border-b border-foreground/10 py-6">
        <AdUnit type="leaderboard" />
      </div>

      <main className="max-w-7xl mx-auto border-x border-foreground/10">

        {/* ═══ SECTION 1: 3-ZONE EDITORIAL SPREAD ═══ */}
        {heroMain ? (
          <section className="grid grid-cols-1 lg:grid-cols-12 border-b border-foreground/10">
            {/* LEFT — Large grayscale image (4 cols) */}
            <div className="lg:col-span-4 lg:border-r border-foreground/10">
              <Link to={`/blog/${heroMain.slug}`} className="block group h-full">
                <div className="relative overflow-hidden h-full min-h-[300px] lg:min-h-full">
                  {heroMain.cover_image && (
                    <img
                      src={toPublicMediaUrl(heroMain.cover_image)}
                      alt={getTitle(heroMain)}
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                    />
                  )}
                </div>
              </Link>
            </div>

            {/* CENTER — Category + Title + Bullet Summaries (4 cols) */}
            <div className="lg:col-span-4 p-6 lg:p-8 lg:border-r border-foreground/10 flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 bg-primary" />
                <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-primary">
                  {t(categoryI18nKey(heroMain.category || "news"))}
                  {heroMain.subcategory && (
                    <span className="text-muted-foreground ml-1.5">· {t(subcategoryI18nKey(heroMain.subcategory))}</span>
                  )}
                </span>
              </div>
              <Link to={`/blog/${heroMain.slug}`}>
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-serif font-bold leading-[1] tracking-tight mb-6 text-foreground hover:text-primary transition-colors">
                  {getTitle(heroMain)}
                </h1>
              </Link>
              {heroBullets.length > 0 && (
                <ul className="flex flex-col">
                  {heroBullets.map((bullet: string, i: number) => (
                    <li
                      key={i}
                      className="py-3 border-b border-dotted border-foreground/15 last:border-0 text-sm font-sans text-muted-foreground leading-relaxed flex items-start gap-2"
                    >
                      <span className="text-primary mt-1 shrink-0">•</span>
                      <span>{bullet.trim()}</span>
                    </li>
                  ))}
                </ul>
              )}
              {heroBullets.length === 0 && getExcerpt(heroMain) && (
                <p className="text-muted-foreground font-sans text-sm leading-relaxed">
                  {getExcerpt(heroMain)}
                </p>
              )}
            </div>

            {/* RIGHT — Second article image + category + title (4 cols) */}
            <div className="lg:col-span-4 flex flex-col">
              {heroRight ? (
                <Link to={`/blog/${heroRight.slug}`} className="group flex flex-col h-full">
                  <div className="relative overflow-hidden flex-1 min-h-[250px]">
                    {heroRight.cover_image && (
                      <img
                        src={toPublicMediaUrl(heroRight.cover_image)}
                        alt={getTitle(heroRight)}
                        className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                      />
                    )}
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 bg-primary" />
                      <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-primary">
                        {t(categoryI18nKey(heroRight.category || "news"))}
                        {heroRight.subcategory && (
                          <span className="text-muted-foreground ml-1.5">· {t(subcategoryI18nKey(heroRight.subcategory))}</span>
                        )}
                      </span>
                    </div>
                    <h2 className="font-serif font-bold text-xl leading-tight text-foreground group-hover:text-primary transition-colors">
                      {getTitle(heroRight)}
                    </h2>
                  </div>
                </Link>
              ) : (
                <div className="p-6 flex items-center justify-center text-muted-foreground italic font-serif">
                  —
                </div>
              )}
            </div>
          </section>
        ) : (
          <div className="p-6 text-center text-muted-foreground font-serif italic text-xl py-20">
            No articles published yet.
          </div>
        )}

        {/* ═══ SECTION 2: SECONDARY SPREAD (text | image | ad) ═══ */}
        {(secondaryText || secondaryImage) && (
          <section className="grid grid-cols-1 lg:grid-cols-3 border-b border-foreground/10">
            {/* Col 1 — Text-only article */}
            <div className="p-6 lg:border-r border-foreground/10 flex flex-col justify-center">
              {secondaryText && (
                <Link to={`/blog/${secondaryText.slug}`} className="group">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 bg-primary" />
                    <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-primary">
                      {t(categoryI18nKey(secondaryText.category || "news"))}
                    </span>
                  </div>
                  <h3 className="font-serif font-bold text-2xl leading-tight text-foreground mb-3 group-hover:text-primary transition-colors">
                    {getTitle(secondaryText)}
                  </h3>
                  {secondaryText.published_at && (
                    <span className="text-[10px] font-sans font-bold text-muted-foreground uppercase tracking-widest">
                      {format(parseISO(secondaryText.published_at), "MMM dd, yyyy")}
                    </span>
                  )}
                  {getExcerpt(secondaryText) && (
                    <p className="mt-3 text-muted-foreground font-sans text-sm leading-relaxed line-clamp-3">
                      {getExcerpt(secondaryText)}
                    </p>
                  )}
                </Link>
              )}
            </div>

            {/* Col 2 — Large grayscale image */}
            <div className="lg:border-r border-foreground/10">
              {secondaryImage ? (
                <Link to={`/blog/${secondaryImage.slug}`} className="block group h-full">
                  <div className="relative overflow-hidden h-full min-h-[280px]">
                    {secondaryImage.cover_image && (
                      <img
                        src={toPublicMediaUrl(secondaryImage.cover_image)}
                        alt={getTitle(secondaryImage)}
                        className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                      />
                    )}
                    <div className="absolute bottom-0 left-0 bg-primary text-primary-foreground px-2 py-1 text-[9px] font-sans font-bold uppercase tracking-widest">
                      {t(categoryI18nKey(secondaryImage.category || "news"))}
                    </div>
                  </div>
                </Link>
              ) : (
                <div className="min-h-[280px] bg-foreground/[0.03]" />
              )}
            </div>

            {/* Col 3 — Ad unit */}
            <div className="flex items-center justify-center p-6">
              <AdUnit type="sidebar" />
            </div>
          </section>
        )}

        {/* ═══ AD SLOT ═══ */}
        <div className="py-10 border-b border-foreground/10 flex justify-center">
          <AdUnit type="leaderboard" />
        </div>

        {/* ═══ 4-COLUMN ARTICLE GRID ═══ */}
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

        {/* ═══ 3-COLUMN EDITORIAL BLOCK ═══ */}
        <section className="grid grid-cols-1 lg:grid-cols-12 border-b border-foreground/10">
          {/* LEFT — Ad + 2-col text snippets */}
          <div className="lg:col-span-4 lg:border-r border-foreground/10 p-6">
            <AdUnit type="sidebar" className="mb-6" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
              {editorialLeftPosts.map((post) => (
                <Link key={post.id} to={`/blog/${post.slug}`} className="group">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-1.5 h-1.5 bg-primary" />
                    <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-primary">
                      {t(categoryI18nKey(post.category || "news"))}
                    </span>
                  </div>
                  <h4 className="font-serif font-bold text-sm leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-3">
                    {getTitle(post)}
                  </h4>
                  <span className="text-[9px] font-sans text-muted-foreground mt-1 block">
                    {getTimeAgo(post)}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          {/* CENTER — Horizontal mini-cards with thumbnails */}
          <div className="lg:col-span-4 lg:border-r border-foreground/10 p-6">
            <div className="flex flex-col">
              {editorialCenterPosts.map((post, i) => (
                <Link
                  key={post.id}
                  to={`/blog/${post.slug}`}
                  className={`flex gap-4 py-4 group cursor-pointer ${
                    i < editorialCenterPosts.length - 1 ? "border-b border-dotted border-foreground/15" : ""
                  }`}
                >
                  <div className="w-[120px] shrink-0 aspect-[4/3] overflow-hidden">
                    <img
                      src={toPublicMediaUrl(post.cover_image || "/placeholder.svg")}
                      alt={getTitle(post)}
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                    />
                  </div>
                  <div className="flex flex-col justify-center min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-1.5 h-1.5 bg-primary" />
                      <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-primary">
                        {t(categoryI18nKey(post.category || "news"))}
                      </span>
                    </div>
                    <h4 className="font-serif font-bold text-sm leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
                      {getTitle(post)}
                    </h4>
                    <span className="text-[9px] font-sans text-muted-foreground mt-1">
                      {getTimeAgo(post)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* RIGHT — Trending entries + Sponsored card */}
          <div className="lg:col-span-4 p-6 flex flex-col">
            <div className="flex flex-col flex-1">
              {editorialRightPosts.map((post, i) => (
                <Link
                  key={post.id}
                  to={`/blog/${post.slug}`}
                  className={`flex items-start gap-3 py-3 group ${
                    i < editorialRightPosts.length - 1 ? "border-b border-foreground/10" : ""
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 shrink-0 flex items-center justify-center text-[10px] font-bold text-primary">
                    {(post.author_name || "T")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-serif font-bold text-sm leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
                      {getTitle(post)}
                    </h4>
                    <span className="text-[9px] font-sans text-muted-foreground mt-0.5 block">
                      {getTimeAgo(post)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>

            {/* Sponsored card */}
            <div className="mt-4 bg-foreground text-background p-4 flex flex-col">
              <span className="text-[9px] font-sans font-bold uppercase tracking-[0.2em] text-background/50 mb-3">
                {t("sponsor", "Sponsor")}
              </span>
              <div className="aspect-[16/9] bg-background/10 mb-3 overflow-hidden">
                <div className="w-full h-full flex items-center justify-center text-background/30 text-xs italic font-sans">
                  Ad Placeholder
                </div>
              </div>
              <h4 className="font-serif font-bold text-sm leading-snug text-background">
                {t("sponsored_content", "Sponsored Content")}
              </h4>
            </div>
          </div>
        </section>

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

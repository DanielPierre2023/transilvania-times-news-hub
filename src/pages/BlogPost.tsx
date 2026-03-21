import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ShareSuite from "@/components/ShareSuite";
import CommentSection from "@/components/CommentSection";
import { format, parseISO } from "date-fns";
import { toPublicMediaUrl } from "@/lib/mediaUrl";
import { categoryI18nKey, subcategoryI18nKey } from "@/lib/categories";
import { mdToHtml } from "@/lib/markdown";

const SITE_NAME = "Transilvania Times";
const CANONICAL_DOMAIN = "https://transilvaniatimes.com";

const BlogPost = () => {
  const { slug } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const isRo = i18n.language.startsWith("ro");

  const { data: post, isLoading } = useQuery({
    queryKey: ["blog_post", slug],
    queryFn: async () => {
      const { data } = await supabase
        .from("blog_posts")
        .select("*")
        .eq("slug", slug!)
        .eq("status", "published")
        .single();
      return data;
    },
    enabled: !!slug,
  });

  // Related articles (same category, excluding current)
  const { data: relatedPosts = [] } = useQuery({
    queryKey: ["related_posts", post?.category, post?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("blog_posts")
        .select("id, slug, title_en, title_ro, cover_image, category, published_at, author_name")
        .eq("status", "published")
        .eq("category", post!.category!)
        .neq("id", post!.id)
        .order("published_at", { ascending: false })
        .limit(3);
      return data || [];
    },
    enabled: !!post?.category && !!post?.id,
  });

  // Previous / Next navigation
  const { data: adjacentPosts } = useQuery({
    queryKey: ["adjacent_posts", post?.published_at, post?.id],
    queryFn: async () => {
      const pubAt = post!.published_at!;
      const [prevRes, nextRes] = await Promise.all([
        supabase
          .from("blog_posts")
          .select("slug, title_en, title_ro")
          .eq("status", "published")
          .lt("published_at", pubAt)
          .order("published_at", { ascending: false })
          .limit(1),
        supabase
          .from("blog_posts")
          .select("slug, title_en, title_ro")
          .eq("status", "published")
          .gt("published_at", pubAt)
          .order("published_at", { ascending: true })
          .limit(1),
      ]);
      return {
        prev: prevRes.data?.[0] || null,
        next: nextRes.data?.[0] || null,
      };
    },
    enabled: !!post?.published_at && !!post?.id,
  });

  // ═══════════════════════════════════════════════════
  // SEO META INJECTION
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    if (!post) return;

    const title = isRo
      ? (post.seo_title_ro || post.title_ro || post.title_en)
      : (post.seo_title_en || post.title_en);
    const summary = isRo
      ? (post.seo_description_ro || post.summary_ro || post.excerpt_ro || post.summary_en)
      : (post.seo_description_en || post.summary_en || post.excerpt_en);
    const imageUrl = post.cover_image ? toPublicMediaUrl(post.cover_image) : "";
    const fullImageUrl = imageUrl.startsWith("/") ? `${CANONICAL_DOMAIN}${imageUrl}` : imageUrl;
    const articleUrl = `${CANONICAL_DOMAIN}/blog/${slug}`;
    const locale = isRo ? "ro_RO" : "en_US";
    const altLocale = isRo ? "en_US" : "ro_RO";

    document.title = `${title} | ${SITE_NAME}`;

    const injected: HTMLElement[] = [];

    const setMeta = (attr: string, key: string, content: string) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
        injected.push(el);
      }
      el.setAttribute("content", content);
    };

    // Open Graph
    setMeta("property", "og:title", title || "");
    setMeta("property", "og:description", summary || "");
    setMeta("property", "og:image", fullImageUrl);
    setMeta("property", "og:url", articleUrl);
    setMeta("property", "og:type", "article");
    setMeta("property", "og:site_name", SITE_NAME);
    setMeta("property", "og:locale", locale);
    setMeta("property", "og:locale:alternate", altLocale);

    // Twitter Card
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", title || "");
    setMeta("name", "twitter:description", summary || "");
    setMeta("name", "twitter:image", fullImageUrl);

    // Canonical
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
      injected.push(canonical);
    }
    canonical.setAttribute("href", articleUrl);

    // Hreflang
    const hreflangs = [
      { lang: "en", href: `${CANONICAL_DOMAIN}/blog/${slug}` },
      { lang: "ro", href: `${CANONICAL_DOMAIN}/blog/${slug}` },
      { lang: "x-default", href: `${CANONICAL_DOMAIN}/blog/${slug}` },
    ];
    hreflangs.forEach(({ lang: hl, href }) => {
      const link = document.createElement("link");
      link.setAttribute("rel", "alternate");
      link.setAttribute("hreflang", hl);
      link.setAttribute("href", href);
      document.head.appendChild(link);
      injected.push(link);
    });

    // JSON-LD NewsArticle
    const jsonLd = document.createElement("script");
    jsonLd.setAttribute("type", "application/ld+json");
    jsonLd.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: title,
      description: summary,
      image: fullImageUrl ? [fullImageUrl] : [],
      datePublished: post.published_at,
      dateModified: post.updated_at || post.published_at,
      author: { "@type": "Person", name: post.author_name || SITE_NAME },
      publisher: {
        "@type": "Organization",
        name: SITE_NAME,
        url: CANONICAL_DOMAIN,
      },
      mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl },
      inLanguage: isRo ? "ro" : "en",
    });
    document.head.appendChild(jsonLd);
    injected.push(jsonLd);

    return () => {
      injected.forEach((el) => el.parentNode?.removeChild(el));
      document.title = SITE_NAME;
    };
  }, [post, isRo, slug]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-3xl mx-auto px-4 py-20 text-center text-muted-foreground">Loading…</div>
        <Footer />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-3xl mx-auto px-4 py-20 text-center">
          <h1 className="text-3xl font-serif font-bold text-foreground">Article not found</h1>
        </div>
        <Footer />
      </div>
    );
  }

  const title = isRo ? post.title_ro || post.title_en : post.title_en;
  const rawContent = isRo ? post.content_ro || post.content_en : post.content_en;
  const content = mdToHtml(rawContent || "");
  const summary = isRo ? post.summary_ro || post.summary_en : post.summary_en;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <article className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-8">
          {post.category && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 bg-primary" />
              <Link
                to={`/category/${post.category}`}
                className="text-primary font-sans font-bold text-[10px] uppercase tracking-[0.2em] hover:underline"
              >
                {t(categoryI18nKey(post.category))}
              </Link>
              {(post as any).subcategory && (
                <Link
                  to={`/category/${post.category}/${(post as any).subcategory}`}
                  className="text-muted-foreground font-sans text-[10px] uppercase tracking-[0.1em] ml-2 hover:underline"
                >
                  · {t(subcategoryI18nKey((post as any).subcategory))}
                </Link>
              )}
            </div>
          )}
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground leading-tight mb-4">
            {title}
          </h1>
          <div className="flex items-center gap-3 text-muted-foreground font-sans text-sm">
            {post.author_name && <span>{t("by_author")} {post.author_name}</span>}
            {post.published_at && (
              <>
                <span>•</span>
                <span>{format(parseISO(post.published_at), "MMMM dd, yyyy")}</span>
              </>
            )}
            {post.reading_time_min && (
              <>
                <span>•</span>
                <span>{post.reading_time_min} min read</span>
              </>
            )}
          </div>
        </div>

        {/* Share Suite — Editorial Row */}
        <ShareSuite
          title={title || ""}
          url={typeof window !== "undefined" ? window.location.href : ""}
          summary={summary || ""}
          tags={post.tags || []}
        />

        {post.cover_image && (
          <figure className="mb-8">
            <img src={toPublicMediaUrl(post.cover_image)} alt={title} className="w-full aspect-video object-cover border border-foreground/5" />
            <figcaption className="text-[10px] font-sans text-muted-foreground uppercase tracking-widest mt-2">
              {isRo ? "Imagine generată cu AI de redacție" : "Image generated with AI by the editorial team"}
            </figcaption>
          </figure>
        )}

        {/* Lede — professional lead paragraph */}
        {summary && (
          <p className="article-lede text-xl text-foreground font-serif leading-relaxed mb-8">
            {summary}
          </p>
        )}

        {/* Article body — markdown converted to HTML */}
        <div
          className="article-body prose prose-lg max-w-none font-sans text-foreground prose-p:leading-relaxed prose-a:text-primary prose-a:underline"
          dangerouslySetInnerHTML={{ __html: content }}
        />

        {/* SEO Tag Pills */}
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-10">
            {post.tags.map((tag: string) => (
              <span key={tag} className="bg-foreground text-background px-3 py-1 text-[10px] font-bold uppercase tracking-widest">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Previous / Next Navigation */}
        {adjacentPosts && (adjacentPosts.prev || adjacentPosts.next) && (
          <div className="flex justify-between items-start gap-4 mt-12 pt-8 border-t border-foreground/10">
            {adjacentPosts.prev ? (
              <Link
                to={`/blog/${adjacentPosts.prev.slug}`}
                className="group flex flex-col items-start max-w-[45%]"
              >
                <span className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-1">
                  ← {t("previous")}
                </span>
                <span className="text-sm font-serif font-bold text-foreground group-hover:text-primary transition-colors leading-tight">
                  {isRo ? adjacentPosts.prev.title_ro || adjacentPosts.prev.title_en : adjacentPosts.prev.title_en}
                </span>
              </Link>
            ) : <div />}
            {adjacentPosts.next ? (
              <Link
                to={`/blog/${adjacentPosts.next.slug}`}
                className="group flex flex-col items-end max-w-[45%] text-right"
              >
                <span className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-1">
                  {t("next")} →
                </span>
                <span className="text-sm font-serif font-bold text-foreground group-hover:text-primary transition-colors leading-tight">
                  {isRo ? adjacentPosts.next.title_ro || adjacentPosts.next.title_en : adjacentPosts.next.title_en}
                </span>
              </Link>
            ) : <div />}
          </div>
        )}

        {/* Related Articles */}
        {relatedPosts.length > 0 && (
          <div className="mt-12 pt-8 border-t border-foreground/10">
            <h2 className="text-lg font-serif font-bold text-foreground mb-6 uppercase tracking-tight">
              {t("related_articles")}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {relatedPosts.map((rp: any) => (
                <Link
                  key={rp.id}
                  to={`/blog/${rp.slug}`}
                  className="group flex flex-col"
                >
                  {rp.cover_image && (
                    <div className="overflow-hidden mb-3 border border-foreground/5">
                      <img
                        src={toPublicMediaUrl(rp.cover_image)}
                        alt={isRo ? rp.title_ro || rp.title_en : rp.title_en}
                        className="w-full aspect-[3/2] object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                      />
                    </div>
                  )}
                  <h3 className="text-sm font-serif font-bold text-foreground leading-tight group-hover:text-primary transition-colors">
                    {isRo ? rp.title_ro || rp.title_en : rp.title_en}
                  </h3>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Comment Section */}
        <CommentSection
          postId={post.id}
          postTitle={title || ""}
          postExcerpt={summary || ""}
        />
      </article>

      {/* Sticky Mobile Share Dock */}
      <ShareSuite
        title={title || ""}
        url={typeof window !== "undefined" ? window.location.href : ""}
        summary={summary || ""}
        tags={post.tags || []}
        sticky
      />

      <Footer />
    </div>
  );
};

export default BlogPost;

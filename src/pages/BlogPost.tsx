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
          <img src={toPublicMediaUrl(post.cover_image)} alt={title} className="w-full aspect-video object-cover mb-8 border border-foreground/5" />
        )}

        {/* Lede — professional lead paragraph */}
        {summary && (
          <p className="text-xl text-foreground font-serif leading-relaxed mb-8 first-letter:text-5xl first-letter:font-bold first-letter:float-left first-letter:mr-2 first-letter:mt-1">
            {summary}
          </p>
        )}

        {/* Article body — markdown converted to HTML */}
        <div
          className="prose prose-lg max-w-none font-sans text-foreground prose-p:mb-5 prose-p:leading-relaxed prose-a:text-primary prose-a:underline"
          dangerouslySetInnerHTML={{ __html: content }}
        />

        {/* SEO Tag Pills */}
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-10">
            {post.tags.map((tag: string) => (
              <span key={tag} className="bg-espresso text-paper px-3 py-1 text-[10px] font-bold uppercase tracking-widest">
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
                  ← {t("previous") || "Previous"}
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
                  {t("next") || "Next"} →
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
              {t("related_articles") || "Related Articles"}
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

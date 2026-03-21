import { useParams } from "react-router-dom";
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

const BlogPost = () => {
  const { slug } = useParams<{ slug: string }>();
  const { i18n, t: _t } = useTranslation();
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

  const { t } = useTranslation();
  const title = isRo ? post.title_ro || post.title_en : post.title_en;
  const content = isRo ? post.content_ro || post.content_en : post.content_en;
  const summary = isRo ? post.summary_ro || post.summary_en : post.summary_en;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <article className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-8">
          {post.category && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 bg-primary" />
              <span className="text-primary font-sans font-bold text-[10px] uppercase tracking-[0.2em]">
                {post.category}
              </span>
            </div>
          )}
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground leading-tight mb-4">
            {title}
          </h1>
          <div className="flex items-center gap-3 text-muted-foreground font-sans text-sm">
            {post.author_name && <span>By {post.author_name}</span>}
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

        {summary && (
          <p className="text-lg text-muted-foreground font-sans italic mb-8 border-l-4 border-primary pl-4">
            {summary}
          </p>
        )}

        <div
          className="prose prose-lg max-w-none font-sans text-foreground"
          dangerouslySetInnerHTML={{ __html: content || "" }}
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

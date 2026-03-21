import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { format, parseISO } from "date-fns";
import { categoryI18nKey } from "@/lib/categories";
import { toPublicMediaUrl } from "@/lib/mediaUrl";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const PAGE_SIZE = 12;

const Blog = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isRo = lang.startsWith("ro");
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

  const { data, isLoading } = useQuery({
    queryKey: ["public_blog_posts", page],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data: posts, count } = await supabase
        .from("blog_posts")
        .select("*", { count: "exact" })
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .range(from, to);
      return { posts: posts || [], total: count || 0 };
    },
  });

  const posts = data?.posts || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const goToPage = (p: number) => {
    if (p === 1) {
      searchParams.delete("page");
    } else {
      searchParams.set("page", String(p));
    }
    setSearchParams(searchParams);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="border-b border-foreground/20 mb-10 pb-4">
          <h1 className="text-3xl font-serif font-bold text-foreground uppercase tracking-tight">
            {t("blog_title") || "Blog"}
          </h1>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground text-center py-20">Loading…</p>
        ) : posts.length === 0 ? (
          <p className="text-muted-foreground text-center py-20 font-serif italic text-xl">
            No articles published yet.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {posts.map((post) => (
                <Link
                  key={post.id}
                  to={`/blog/${post.slug}`}
                  className="group flex flex-col"
                >
                  {post.cover_image && (
                    <div className="overflow-hidden mb-4 border border-foreground/5">
                      <img
                        src={toPublicMediaUrl(post.cover_image)}
                        alt={isRo ? post.title_ro || post.title_en : post.title_en}
                        className="w-full aspect-[3/2] object-cover grayscale group-hover:grayscale-0 transition-all duration-700 transform group-hover:scale-105"
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-primary" />
                    <span className="text-primary font-sans font-bold text-[10px] uppercase tracking-[0.1em]">
                      {t(categoryI18nKey(post.category || "news"))}
                    </span>
                  </div>
                  <h3 className="text-lg font-serif font-bold text-foreground leading-tight mb-2 group-hover:text-primary transition-colors">
                    {isRo ? post.title_ro || post.title_en : post.title_en}
                  </h3>
                  <p className="text-muted-foreground font-sans text-sm line-clamp-3 mb-3">
                    {isRo ? post.excerpt_ro || post.excerpt_en : post.excerpt_en}
                  </p>
                  <div className="text-muted-foreground font-sans text-xs mt-auto flex items-center gap-1">
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

            {/* Pagination */}
            {totalPages > 1 && (
              <Pagination className="mt-12">
                <PaginationContent>
                  {page > 1 && (
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => goToPage(page - 1)}
                        className="cursor-pointer"
                      />
                    </PaginationItem>
                  )}
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(
                      (p) =>
                        p === 1 ||
                        p === totalPages ||
                        Math.abs(p - page) <= 2
                    )
                    .map((p, idx, arr) => (
                      <PaginationItem key={p}>
                        {idx > 0 && arr[idx - 1] !== p - 1 && (
                          <span className="px-2 text-muted-foreground">…</span>
                        )}
                        <PaginationLink
                          isActive={p === page}
                          onClick={() => goToPage(p)}
                          className="cursor-pointer"
                        >
                          {p}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                  {page < totalPages && (
                    <PaginationItem>
                      <PaginationNext
                        onClick={() => goToPage(page + 1)}
                        className="cursor-pointer"
                      />
                    </PaginationItem>
                  )}
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Blog;

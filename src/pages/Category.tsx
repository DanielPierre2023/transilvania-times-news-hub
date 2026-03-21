import React from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AdUnit from "@/components/AdUnit";
import ArticleCard from "@/components/ArticleCard";
import { format, parseISO } from "date-fns";
import { SUBCATEGORIES, categoryI18nKey, subcategoryI18nKey } from "@/lib/categories";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const PAGE_SIZE = 12;

const Category = () => {
  const { name, sub } = useParams<{ name: string; sub?: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const isRo = i18n.language.startsWith("ro");
  const categoryLabel = name ? t(categoryI18nKey(name)) : "";

  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

  const { data: dbData } = useQuery({
    queryKey: ["category_blog_posts", name, sub, page],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from("blog_posts")
        .select("*", { count: "exact" })
        .eq("status", "published")
        .eq("category", name?.toLowerCase() || "")
        .order("published_at", { ascending: false });
      if (sub) {
        query = query.eq("subcategory", sub.toLowerCase());
      }
      const { data, count } = await query.range(from, to);
      return { posts: data || [], total: count || 0 };
    },
    enabled: !!name,
  });

  const dbPosts = dbData?.posts || [];
  const totalPages = Math.max(1, Math.ceil((dbData?.total || 0) / PAGE_SIZE));

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

      <main className="max-w-7xl mx-auto border-x border-foreground/10 px-0">
        {/* Category header */}
        <div className="border-b border-foreground/10 px-6 py-8">
          <h1 className="text-3xl font-serif font-bold text-foreground uppercase tracking-tight">
            {categoryLabel || t("all_articles")}
          </h1>
          {sub && (
            <p className="text-sm text-muted-foreground mt-1">
              {t(subcategoryI18nKey(sub))}
            </p>
          )}
        </div>

        {/* Subcategory tabs — desktop: underline tabs, mobile: dropdown */}
        {name && (
          <>
            {/* Mobile dropdown */}
            <div className="md:hidden border-b border-foreground/10 px-6 py-3">
              <select
                value={sub || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  navigate(val ? `/category/${name}/${val}` : `/category/${name}`);
                }}
                className="w-full bg-background border border-foreground/20 rounded px-4 py-2.5 text-sm font-sans font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">{t("all_articles")}</option>
                {SUBCATEGORIES.map((s) => (
                  <option key={s} value={s}>{t(subcategoryI18nKey(s))}</option>
                ))}
              </select>
            </div>
            {/* Desktop tabs */}
            <div className="hidden md:flex items-center gap-0 border-b border-foreground/10 px-6">
              <Link
                to={`/category/${name}`}
                className={`px-4 py-3 text-xs font-sans font-bold uppercase tracking-widest transition-colors border-b-2 ${
                  !sub
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t("all_articles")}
              </Link>
              {SUBCATEGORIES.map((s) => (
                <Link
                  key={s}
                  to={`/category/${name}/${s}`}
                  className={`px-4 py-3 text-xs font-sans font-bold uppercase tracking-widest transition-colors border-b-2 ${
                    sub === s
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(subcategoryI18nKey(s))}
                </Link>
              ))}
            </div>
          </>
        )}

        {/* Article grid */}
        {dbPosts.length === 0 ? (
          <p className="text-muted-foreground text-center py-20 font-serif italic text-xl">
            No articles in this category yet.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 newspaper-grid">
              {dbPosts.map((post, index) => (
                <React.Fragment key={post.id}>
                  <ArticleCard
                    slug={post.slug}
                    category={post.category || "news"}
                    subcategory={(post as any).subcategory}
                    title={isRo ? post.title_ro || post.title_en : post.title_en}
                    timeAgo={post.published_at ? format(parseISO(post.published_at), "MMM dd, yyyy") : undefined}
                    image={post.cover_image || "/placeholder.svg"}
                    linkPrefix="/blog/"
                  />
                  {index === 3 && (
                    <div className="col-span-full">
                      <AdUnit type="leaderboard" />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>

            {totalPages > 1 && (
              <Pagination className="py-10 border-t border-foreground/10">
                <PaginationContent>
                  {page > 1 && (
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => goToPage(page - 1)}
                        className="cursor-pointer"
                      >
                        {t("previous")}
                      </PaginationPrevious>
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
                      >
                        {t("next")}
                      </PaginationNext>
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

export default Category;

import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { articles, t as tBi, tArr } from "@/data/articles";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ArticleCard from "@/components/ArticleCard";
import MostReadSidebar from "@/components/MostReadSidebar";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";

const SearchResults = () => {
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isRo = lang.startsWith("ro");
  const query = searchParams.get("q")?.toLowerCase() || "";

  // Static article results
  const staticResults = query
    ? articles.filter(
        (a) =>
          tBi(a.title, lang).toLowerCase().includes(query) ||
          tBi(a.category, lang).toLowerCase().includes(query) ||
          tArr(a.body, lang).some((p) => p.toLowerCase().includes(query))
      )
    : [];

  // DB blog post results
  const { data: dbResults = [] } = useQuery({
    queryKey: ["search_blog_posts", query],
    queryFn: async () => {
      if (!query) return [];
      const { data } = await supabase
        .from("blog_posts")
        .select("*")
        .eq("status", "published")
        .or(`title_en.ilike.%${query}%,title_ro.ilike.%${query}%,category.ilike.%${query}%`)
        .order("published_at", { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: !!query,
  });

  const totalResults = staticResults.length + dbResults.length;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="border-b border-foreground/20 mb-12 pb-6">
          <p className="text-muted-foreground font-sans text-xs uppercase tracking-[0.2em] mb-2 font-bold">
            {t("search_results_for")}
          </p>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground italic tracking-tighter">
            "{searchParams.get("q") || ""}"
          </h1>
          <p className="text-muted-foreground font-sans text-sm mt-4 uppercase font-medium">
            {totalResults} {t("articles_found")}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-8">
            {totalResults > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-12">
                {staticResults.map((a) => (
                  <ArticleCard
                    key={a.slug}
                    slug={a.slug}
                    category={tBi(a.category, lang)}
                    title={tBi(a.title, lang)}
                    author={a.author}
                    timeAgo={tBi(a.timeAgo, lang)}
                    excerpt={tBi(a.excerpt, lang)}
                    image={a.image}
                  />
                ))}
                {dbResults.map((post) => (
                  <Link key={post.id} to={`/blog/${post.slug}`} className="flex flex-col group">
                    {post.cover_image && (
                      <div className="overflow-hidden mb-3 border border-foreground/5">
                        <img src={post.cover_image} alt={post.title_en} className="w-full aspect-[3/2] object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 bg-primary" />
                      <span className="text-primary font-sans font-bold text-[10px] uppercase tracking-[0.1em]">{post.category || "news"}</span>
                    </div>
                    <h3 className="font-serif font-bold text-foreground text-lg leading-tight mb-2 group-hover:text-primary transition-colors">
                      {isRo ? post.title_ro || post.title_en : post.title_en}
                    </h3>
                    <p className="text-muted-foreground font-sans text-sm line-clamp-2">
                      {isRo ? post.excerpt_ro || post.excerpt_en : post.excerpt_en}
                    </p>
                    <div className="text-muted-foreground font-sans text-xs mt-2">
                      {post.author_name}
                      {post.published_at && ` • ${format(parseISO(post.published_at), "MMM dd, yyyy")}`}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-20 text-center border border-dashed border-foreground/20">
                <p className="font-serif text-2xl text-foreground/40 italic">
                  {t("no_results")}
                </p>
              </div>
            )}
          </div>

          <div className="lg:col-span-4">
            <MostReadSidebar />
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default SearchResults;

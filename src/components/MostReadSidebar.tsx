import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { categoryI18nKey } from "@/lib/categories";

const MostReadSidebar = () => {
  const { t, i18n } = useTranslation();
  const isRo = i18n.language.startsWith("ro");

  const { data: posts = [] } = useQuery({
    queryKey: ["most_read_sidebar"],
    queryFn: async () => {
      const { data } = await supabase
        .from("blog_posts")
        .select("id, slug, title_en, title_ro, category, published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(5);
      return data || [];
    },
  });

  return (
    <aside className="border-2 border-foreground p-6 bg-background shadow-[10px_10px_0px_0px_hsl(var(--foreground)/0.05)]">
      <h3 className="font-serif italic font-bold text-2xl border-b-2 border-primary pb-2 mb-6 text-foreground">
        {t("most_read")}
      </h3>
      <div className="flex flex-col">
        {posts.map((post, i) => (
          <Link
            key={post.id}
            to={`/blog/${post.slug}`}
            className="flex gap-4 py-4 border-b border-foreground/10 last:border-0 group cursor-pointer"
          >
            <span className="text-3xl font-serif font-bold text-foreground/20 group-hover:text-primary transition-colors shrink-0">
              0{i + 1}
            </span>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-primary" />
                <span className="text-primary font-sans font-bold text-[9px] uppercase tracking-widest">
                  {t(categoryI18nKey(post.category || "news"))}
                </span>
              </div>
              <p className="font-serif font-bold text-foreground leading-snug group-hover:italic transition-all text-sm">
                {isRo ? post.title_ro || post.title_en : post.title_en}
              </p>
            </div>
          </Link>
        ))}
        {posts.length === 0 && (
          <p className="text-muted-foreground text-sm italic font-serif">—</p>
        )}
      </div>
    </aside>
  );
};

export default MostReadSidebar;

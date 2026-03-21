import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toPublicMediaUrl } from "@/lib/mediaUrl";
import { categoryI18nKey, subcategoryI18nKey } from "@/lib/categories";

interface ArticleCardProps {
  slug: string;
  category: string;
  title: string;
  timeAgo?: string;
  image: string;
  subcategory?: string;
  linkPrefix?: string;
  variant?: "hero" | "grid";
  excerpt?: string;
  author?: string;
}

const ArticleCard = ({
  slug,
  category,
  title,
  timeAgo,
  image,
  subcategory,
  linkPrefix = "/blog/",
  variant = "grid",
  excerpt,
  author,
}: ArticleCardProps) => {
  const { t } = useTranslation();

  if (variant === "hero") {
    return (
      <Link to={`${linkPrefix}${slug}`} className="block">
        <article className="group cursor-pointer">
          <div className="relative overflow-hidden border border-foreground/5">
            <img
              src={toPublicMediaUrl(image)}
              alt={title}
              className="w-full aspect-video object-cover grayscale group-hover:grayscale-0 transition-all duration-700 ease-in-out transform group-hover:scale-105"
            />
            <div className="absolute bottom-0 left-0 bg-primary text-primary-foreground px-2.5 py-1 text-[9px] font-sans font-bold uppercase tracking-widest flex items-center gap-1.5">
              {t(categoryI18nKey(category))}
              {subcategory && (
                <span className="opacity-80">· {t(subcategoryI18nKey(subcategory))}</span>
              )}
            </div>
          </div>
          <div className="mt-4">
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground leading-tight group-hover:text-primary transition-colors">
              {title}
            </h2>
            {excerpt && (
              <p className="mt-2 text-muted-foreground font-sans text-sm leading-relaxed line-clamp-3">
                {excerpt}
              </p>
            )}
            <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground font-sans">
              {author && <span className="font-medium">{t("by_author")} {author}</span>}
              {author && timeAgo && <span>•</span>}
              {timeAgo && <span>{timeAgo}</span>}
            </div>
          </div>
        </article>
      </Link>
    );
  }

  // Grid variant — newspaper card
  return (
    <Link
      to={`${linkPrefix}${slug}`}
      className="group flex flex-col p-4"
    >
      <div className="relative overflow-hidden mb-4 aspect-[4/3] border border-foreground/5">
        <img
          src={toPublicMediaUrl(image)}
          alt={title}
          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700 ease-in-out transform group-hover:scale-105"
        />
        <div className="absolute bottom-0 left-0 bg-primary text-primary-foreground px-2 py-1 text-[9px] font-sans font-bold uppercase tracking-widest flex items-center gap-1.5">
          {t(categoryI18nKey(category))}
          {subcategory && (
            <span className="opacity-80">· {t(subcategoryI18nKey(subcategory))}</span>
          )}
        </div>
      </div>
      <h3 className="font-serif font-bold text-lg leading-tight text-foreground mb-2 group-hover:text-primary transition-colors">
        {title}
      </h3>
      <div className="flex items-center gap-2 mt-auto pt-4 border-t border-foreground/5">
        {timeAgo && (
          <span className="text-[10px] font-sans font-bold text-muted-foreground uppercase tracking-widest">
            {timeAgo}
          </span>
        )}
      </div>
    </Link>
  );
};

export default ArticleCard;

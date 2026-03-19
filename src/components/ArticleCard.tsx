import { Link } from "react-router-dom";

interface ArticleCardProps {
  slug: string;
  category: string;
  title: string;
  author: string;
  timeAgo: string;
  excerpt: string;
  image: string;
  featured?: boolean;
}

const ArticleCard = ({ slug, category, title, author, timeAgo, excerpt, image, featured = false }: ArticleCardProps) => {
  if (featured) {
    return (
      <Link to={`/article/${slug}`} className="block">
        <article className="group cursor-pointer">
          <div className="overflow-hidden rounded">
            <img
              src={image}
              alt={title}
              className="w-full h-[400px] object-cover group-hover:scale-105 transition-transform duration-500"
            />
          </div>
          <div className="mt-4">
            <span className="inline-block bg-primary text-primary-foreground text-xs font-sans font-semibold px-3 py-1 rounded mb-3">
              {category}
            </span>
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground leading-tight group-hover:text-primary transition-colors">
              {title}
            </h2>
            <p className="mt-2 text-clay font-sans text-sm leading-relaxed line-clamp-3">{excerpt}</p>
            <div className="flex items-center gap-3 mt-3 text-xs text-clay font-sans">
              <span className="font-medium">By {author}</span>
              <span>•</span>
              <span>{timeAgo}</span>
            </div>
          </div>
        </article>
      </Link>
    );
  }

  return (
    <Link to={`/article/${slug}`} className="block">
      <article className="group cursor-pointer flex gap-4">
        <div className="overflow-hidden rounded shrink-0 w-32 h-24">
          <img
            src={image}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        </div>
        <div className="flex flex-col justify-center">
          <span className="text-xs font-sans font-semibold text-primary mb-1">{category}</span>
          <h3 className="font-serif font-bold text-foreground text-sm leading-snug group-hover:text-primary transition-colors line-clamp-2">
            {title}
          </h3>
          <div className="flex items-center gap-2 mt-1.5 text-xs text-clay font-sans">
            <span>By {author}</span>
            <span>•</span>
            <span>{timeAgo}</span>
          </div>
        </div>
      </article>
    </Link>
  );
};

export default ArticleCard;

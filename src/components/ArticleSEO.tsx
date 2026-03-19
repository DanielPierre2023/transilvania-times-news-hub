import { useEffect } from "react";
import type { Article } from "@/data/articles";

const ArticleSEO = ({ article }: { article: Article }) => {
  useEffect(() => {
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: article.title,
      image: [article.image],
      datePublished: "2026-03-19T14:30:00+02:00",
      dateModified: "2026-03-19T14:30:00+02:00",
      author: [
        {
          "@type": "Person",
          name: article.author,
        },
      ],
      publisher: {
        "@type": "Organization",
        name: "Transilvania Times",
      },
      description: article.excerpt,
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": `https://transilvaniatimes.com/article/${article.slug}`,
      },
    };

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(jsonLd);
    script.id = "article-jsonld";

    const existing = document.getElementById("article-jsonld");
    if (existing) existing.remove();
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [article]);

  return null;
};

export default ArticleSEO;

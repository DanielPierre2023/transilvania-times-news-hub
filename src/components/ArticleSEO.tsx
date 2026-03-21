import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Article } from "@/data/articles";
import { t as tBi } from "@/data/articles";

const ArticleSEO = ({ article }: { article: Article }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  useEffect(() => {
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: tBi(article.title, lang),
      image: [article.image],
      datePublished: new Date().toISOString(),
      dateModified: new Date().toISOString(),
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
      description: tBi(article.excerpt, lang),
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

    // hreflang tags
    const hreflangs = [
      { lang: "en", href: `https://transilvaniatimes.com/en/article/${article.slug}` },
      { lang: "ro", href: `https://transilvaniatimes.com/ro/article/${article.slug}` },
      { lang: "x-default", href: `https://transilvaniatimes.com/article/${article.slug}` },
    ];
    const linkEls = hreflangs.map(({ lang: l, href }) => {
      const link = document.createElement("link");
      link.rel = "alternate";
      link.hreflang = l;
      link.href = href;
      link.dataset.seo = "hreflang";
      document.head.appendChild(link);
      return link;
    });

    return () => {
      script.remove();
      linkEls.forEach((el) => el.remove());
    };
  }, [article, lang]);

  return null;
};

export default ArticleSEO;

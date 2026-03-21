import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Article } from "@/data/articles";
import { t as tBi } from "@/data/articles";
import { toPublicMediaUrl } from "@/lib/mediaUrl";

const ArticleSEO = ({ article }: { article: Article }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  useEffect(() => {
    const headline = tBi(article.title, lang);
    const description = tBi(article.excerpt, lang);
    const articleUrl = `https://transilvaniatimes.com/article/${article.slug}`;

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline,
      image: [toPublicMediaUrl(article.image)],
      datePublished: new Date().toISOString(),
      dateModified: new Date().toISOString(),
      author: [{ "@type": "Person", name: article.author }],
      publisher: { "@type": "Organization", name: "Transilvania Times" },
      description,
      mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl },
    };

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(jsonLd);
    script.id = "article-jsonld";

    const existing = document.getElementById("article-jsonld");
    if (existing) existing.remove();
    document.head.appendChild(script);

    // OG + Twitter meta tags
    const metaTags: Record<string, string> = {
      "og:title": headline,
      "og:description": description,
      "og:image": toPublicMediaUrl(article.image),
      "og:url": articleUrl,
      "og:type": "article",
      "og:site_name": "Transilvania Times",
      "twitter:card": "summary_large_image",
      "twitter:title": headline,
      "twitter:description": description,
      "twitter:image": toPublicMediaUrl(article.image),
    };

    const metaEls: HTMLMetaElement[] = [];
    for (const [key, value] of Object.entries(metaTags)) {
      const attr = key.startsWith("twitter:") ? "name" : "property";
      // Remove existing
      const existingMeta = document.querySelector(`meta[${attr}="${key}"]`);
      if (existingMeta) existingMeta.remove();
      const meta = document.createElement("meta");
      meta.setAttribute(attr, key);
      meta.content = value;
      meta.dataset.seo = "og";
      document.head.appendChild(meta);
      metaEls.push(meta);
    }

    // hreflang tags
    const hreflangs = [
      { lang: "en", href: `https://transilvaniatimes.com/en/article/${article.slug}` },
      { lang: "ro", href: `https://transilvaniatimes.com/ro/article/${article.slug}` },
      { lang: "x-default", href: articleUrl },
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
      metaEls.forEach((el) => el.remove());
    };
  }, [article, lang]);

  return null;
};

export default ArticleSEO;

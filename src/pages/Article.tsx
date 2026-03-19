import { useParams, Link } from "react-router-dom";
import { getArticleBySlug } from "@/data/articles";
import Header from "@/components/Header";
import Newsletter from "@/components/Newsletter";
import Footer from "@/components/Footer";
import NotFound from "./NotFound";

const Article = () => {
  const { slug } = useParams<{ slug: string }>();
  const article = slug ? getArticleBySlug(slug) : undefined;

  if (!article) return <NotFound />;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <header className="max-w-4xl mx-auto px-4 pt-16 text-center md:text-left">
        <div className="flex items-center gap-2 mb-4 justify-center md:justify-start">
          <div className="w-2 h-2 bg-primary" />
          <span className="text-primary font-sans font-bold text-xs uppercase tracking-widest">
            {article.category}
          </span>
        </div>

        <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-bold text-foreground leading-[1.1] mb-6">
          {article.title}
        </h1>

        <div className="flex flex-col md:flex-row justify-between items-center py-4 border-b border-foreground/10">
          <p className="text-muted-foreground font-sans text-lg">{article.date}</p>
          <p className="text-foreground font-sans font-bold text-lg">By {article.author}</p>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-4 py-10">
        <img
          src={article.image}
          alt={article.title}
          className="w-full aspect-[2/1] object-cover shadow-2xl rounded-sm"
        />
      </section>

      <main className="max-w-4xl mx-auto px-4 pb-20 font-sans text-foreground text-lg leading-relaxed space-y-8">
        {article.body.map((paragraph, i) => {
          const subheading = article.subheadings?.find((s) => s.index === i);
          return (
            <div key={i}>
              {subheading && (
                <h2 className="text-2xl font-serif font-bold pt-4 uppercase">
                  {subheading.title}
                </h2>
              )}
              <p>{paragraph}</p>
            </div>
          );
        })}

        <div className="pt-12 flex justify-center md:justify-start">
          <Link
            to="/"
            className="bg-primary text-primary-foreground px-10 py-4 font-bold uppercase tracking-tight hover:bg-accent transition-all"
          >
            Go Back to Homepage
          </Link>
        </div>
      </main>

      <Newsletter />
      <Footer />
    </div>
  );
};

export default Article;

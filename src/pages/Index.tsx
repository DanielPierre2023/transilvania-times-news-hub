import Header from "@/components/Header";
import ArticleCard from "@/components/ArticleCard";
import Newsletter from "@/components/Newsletter";
import Footer from "@/components/Footer";
import { featuredArticle, articles } from "@/data/articles";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto max-w-6xl px-4 py-8">
        <ArticleCard
          slug={featuredArticle.slug}
          category={featuredArticle.category}
          title={featuredArticle.title}
          author={featuredArticle.author}
          timeAgo={featuredArticle.timeAgo}
          excerpt={featuredArticle.excerpt}
          image={featuredArticle.image}
          featured
        />

        <div className="mt-10 border-t border-foreground/20 pt-8">
          <h2 className="text-xl font-serif font-bold text-foreground mb-6">Latest Stories</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {articles.slice(1).map((article) => (
              <ArticleCard key={article.slug} slug={article.slug} {...article} />
            ))}
          </div>
        </div>
      </main>

      <Newsletter />
      <Footer />
    </div>
  );
};

export default Index;

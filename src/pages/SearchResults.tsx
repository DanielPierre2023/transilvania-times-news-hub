import { useSearchParams } from "react-router-dom";
import { articles } from "@/data/articles";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Newsletter from "@/components/Newsletter";
import ArticleCard from "@/components/ArticleCard";
import MostReadSidebar from "@/components/MostReadSidebar";

const SearchResults = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q")?.toLowerCase() || "";

  const results = query
    ? articles.filter(
        (a) =>
          a.title.toLowerCase().includes(query) ||
          a.category.toLowerCase().includes(query) ||
          a.body.some((p) => p.toLowerCase().includes(query))
      )
    : [];

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="border-b border-foreground/20 mb-12 pb-6">
          <p className="text-muted-foreground font-sans text-xs uppercase tracking-[0.2em] mb-2 font-bold">
            Search Results for:
          </p>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground italic tracking-tighter">
            "{searchParams.get("q") || ""}"
          </h1>
          <p className="text-muted-foreground font-sans text-sm mt-4 uppercase font-medium">
            {results.length} article{results.length !== 1 ? "s" : ""} found
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-8">
            {results.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-12">
                {results.map((a) => (
                  <ArticleCard key={a.slug} {...a} />
                ))}
              </div>
            ) : (
              <div className="py-20 text-center border border-dashed border-foreground/20">
                <p className="font-serif text-2xl text-foreground/40 italic">
                  No matching articles found in our archives.
                </p>
              </div>
            )}
          </div>

          <div className="lg:col-span-4">
            <MostReadSidebar />
          </div>
        </div>
      </div>

      <Newsletter />
      <Footer />
    </div>
  );
};

export default SearchResults;

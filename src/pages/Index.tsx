import Header from "@/components/Header";
import ArticleCard from "@/components/ArticleCard";
import Newsletter from "@/components/Newsletter";
import Footer from "@/components/Footer";

import heroImg from "@/assets/hero-transylvania.jpg";
import politicsImg from "@/assets/article-politics.jpg";
import techImg from "@/assets/article-tech.jpg";
import travelImg from "@/assets/article-travel.jpg";
import educationImg from "@/assets/article-education.jpg";

const articles = [
  {
    category: "Politics",
    title: "Opposition Leader Calls for Early Elections Amid Growing Public Discontent",
    author: "Elena Popescu",
    timeAgo: "2 hours ago",
    excerpt:
      "In a fiery address to parliament, the opposition leader demanded snap elections, citing widespread dissatisfaction with the current government's handling of economic reforms and public services.",
    image: politicsImg,
  },
  {
    category: "Technology",
    title: "Cluj-Napoca Startup Raises €12M in Series A Funding",
    author: "Andrei Moldovan",
    timeAgo: "4 hours ago",
    excerpt:
      "A promising AI startup based in Cluj-Napoca has secured significant funding to expand its operations across Central and Eastern Europe.",
    image: techImg,
  },
  {
    category: "Travel",
    title: "Hidden Gems: 5 Transylvanian Villages You Must Visit This Spring",
    author: "Maria Ionescu",
    timeAgo: "6 hours ago",
    excerpt:
      "From rolling hills to medieval fortified churches, these lesser-known villages offer an authentic taste of rural Transylvanian life.",
    image: travelImg,
  },
  {
    category: "Education",
    title: "Babeș-Bolyai University Launches New Digital Humanities Program",
    author: "Cristian Radu",
    timeAgo: "8 hours ago",
    excerpt:
      "The prestigious university expands its curriculum with a cutting-edge program blending technology and the liberal arts.",
    image: educationImg,
  },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto max-w-6xl px-4 py-8">
        {/* Featured Article */}
        <ArticleCard
          category="Travel"
          title="The Carpathian Renaissance: How Transylvania Is Becoming Europe's Next Cultural Destination"
          author="Alexandru Bălan"
          timeAgo="1 hour ago"
          excerpt="From underground art galleries in Sibiu to world-class music festivals in Cluj-Napoca, Transylvania is shedding its gothic reputation and emerging as a vibrant hub for contemporary culture, drawing artists, entrepreneurs, and travellers from around the globe."
          image={heroImg}
          featured
        />

        {/* Article Grid */}
        <div className="mt-10 border-t border-foreground/20 pt-8">
          <h2 className="text-xl font-serif font-bold text-foreground mb-6">Latest Stories</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {articles.map((article) => (
              <ArticleCard key={article.title} {...article} />
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

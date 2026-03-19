import heroImg from "@/assets/hero-transylvania.jpg";
import politicsImg from "@/assets/article-politics.jpg";
import techImg from "@/assets/article-tech.jpg";
import travelImg from "@/assets/article-travel.jpg";
import educationImg from "@/assets/article-education.jpg";

export interface Article {
  slug: string;
  category: string;
  title: string;
  author: string;
  timeAgo: string;
  date: string;
  excerpt: string;
  image: string;
  body: string[];
  subheadings?: { title: string; index: number }[];
}

export const articles: Article[] = [
  {
    slug: "carpathian-renaissance-transylvania-cultural-destination",
    category: "Travel",
    title: "The Carpathian Renaissance: How Transylvania Is Becoming Europe's Next Cultural Destination",
    author: "Alexandru Bălan",
    timeAgo: "1 hour ago",
    date: "March 19, 2026",
    excerpt:
      "From underground art galleries in Sibiu to world-class music festivals in Cluj-Napoca, Transylvania is shedding its gothic reputation and emerging as a vibrant hub for contemporary culture, drawing artists, entrepreneurs, and travellers from around the globe.",
    image: heroImg,
    body: [
      "From underground art galleries in Sibiu to world-class music festivals in Cluj-Napoca, Transylvania is shedding its gothic reputation and emerging as a vibrant hub for contemporary culture, drawing artists, entrepreneurs, and travellers from around the globe.",
      "The region's transformation has been decades in the making. After the fall of communism, Transylvania's cities began a slow but steady revival, restoring medieval architecture while simultaneously embracing modern creative movements. Today, that evolution has reached a tipping point.",
      "Sibiu, once a quiet Saxon town, now hosts one of Europe's most respected theatre festivals. Its cobblestone streets are lined with independent galleries, artisan workshops, and cafés that double as performance spaces. The city's designation as a European Capital of Culture in 2007 was a catalyst, but the momentum has only grown since.",
      "Cluj-Napoca, often called the unofficial capital of Transylvania, has become the region's tech and cultural powerhouse. The Electric Castle festival draws over 200,000 attendees annually, while the city's startup ecosystem rivals those of much larger European capitals.",
      "Beyond the cities, rural Transylvania offers a different kind of cultural richness. Fortified churches, many of them UNESCO World Heritage Sites, dot the landscape. Villages like Viscri — famously championed by King Charles III — have become models for sustainable tourism.",
      "Local entrepreneurs are capitalising on this interest, opening boutique guesthouses, organic farms, and craft breweries that celebrate the region's unique heritage while appealing to modern travellers seeking authenticity over luxury.",
      "The Transylvanian renaissance is not without challenges. Infrastructure remains underdeveloped in many rural areas, and there are concerns about over-tourism threatening the very authenticity that draws visitors. Local leaders are working to balance growth with preservation.",
      "Yet the trajectory is clear. With direct flights from major European cities now serving Cluj-Napoca and Sibiu, and a growing international media presence, Transylvania is poised to become one of the continent's most compelling destinations for the culturally curious traveller.",
    ],
    subheadings: [
      { title: "The Rise of Sibiu's Art Scene", index: 2 },
      { title: "Cluj-Napoca: Tech Meets Culture", index: 3 },
      { title: "Rural Transylvania's Quiet Revolution", index: 4 },
      { title: "Challenges and the Road Ahead", index: 6 },
    ],
  },
  {
    slug: "opposition-leader-early-elections-public-discontent",
    category: "Politics",
    title: "Opposition Leader Calls for Early Elections Amid Growing Public Discontent",
    author: "Elena Popescu",
    timeAgo: "2 hours ago",
    date: "March 19, 2026",
    excerpt:
      "In a fiery address to parliament, the opposition leader demanded snap elections, citing widespread dissatisfaction with the current government's handling of economic reforms and public services.",
    image: politicsImg,
    body: [
      "In a fiery address to parliament, the opposition leader demanded snap elections, citing widespread dissatisfaction with the current government's handling of economic reforms and public services.",
      "The speech, delivered to a packed chamber, drew both applause and jeers. Supporters rallied outside the building, holding signs demanding accountability and transparency from elected officials.",
      "Public opinion polls released this week show that confidence in the ruling coalition has dropped to its lowest point in over a decade. Economic stagnation, rising living costs, and a perceived lack of progress on infrastructure projects have fuelled the discontent.",
      "Political analysts suggest that while early elections remain unlikely under the current constitutional framework, the pressure is mounting. Several coalition partners have publicly expressed reservations about the government's direction.",
      "The opposition has presented a ten-point reform agenda focusing on anti-corruption measures, judicial independence, and accelerated EU integration. Whether these proposals gain traction will depend on the coming weeks of parliamentary debate.",
      "International observers are watching closely. The European Commission has urged all parties to engage in constructive dialogue, emphasising the importance of political stability for ongoing EU accession negotiations.",
    ],
    subheadings: [
      { title: "Public Trust at Historic Low", index: 2 },
      { title: "The Opposition's Reform Agenda", index: 4 },
    ],
  },
  {
    slug: "cluj-napoca-startup-series-a-funding",
    category: "Technology",
    title: "Cluj-Napoca Startup Raises €12M in Series A Funding",
    author: "Andrei Moldovan",
    timeAgo: "4 hours ago",
    date: "March 19, 2026",
    excerpt:
      "A promising AI startup based in Cluj-Napoca has secured significant funding to expand its operations across Central and Eastern Europe.",
    image: techImg,
    body: [
      "A promising AI startup based in Cluj-Napoca has secured significant funding to expand its operations across Central and Eastern Europe. The €12 million Series A round was led by a prominent Berlin-based venture capital firm.",
      "The company, which specialises in natural language processing for Eastern European languages, plans to use the funds to triple its engineering team and open offices in Budapest and Warsaw.",
      "Founded in 2023 by two Babeș-Bolyai University graduates, the startup has already attracted clients in the financial services and healthcare sectors. Its flagship product uses advanced machine learning to process and analyse documents in Romanian, Hungarian, and Polish.",
      "The funding round reflects growing international interest in Central and Eastern Europe's tech ecosystem. Cluj-Napoca alone is now home to over 300 tech companies, earning it the nickname 'Silicon Valley of Transylvania.'",
      "Industry experts note that the region's combination of strong technical education, lower operating costs, and EU membership makes it an increasingly attractive destination for tech investment.",
      "The startup's CEO stated that the goal is to become the leading NLP provider for the CEE region within three years, competing with established Western European players by offering superior accuracy for regional languages.",
    ],
    subheadings: [
      { title: "From University Project to Series A", index: 2 },
      { title: "The CEE Tech Boom", index: 3 },
    ],
  },
  {
    slug: "hidden-gems-transylvanian-villages-spring",
    category: "Travel",
    title: "Hidden Gems: 5 Transylvanian Villages You Must Visit This Spring",
    author: "Maria Ionescu",
    timeAgo: "6 hours ago",
    date: "March 19, 2026",
    excerpt:
      "From rolling hills to medieval fortified churches, these lesser-known villages offer an authentic taste of rural Transylvanian life.",
    image: travelImg,
    body: [
      "From rolling hills to medieval fortified churches, these lesser-known villages offer an authentic taste of rural Transylvanian life. While tourists flock to Brașov and Sighișoara, these hidden gems remain blissfully uncrowded.",
      "Viscri, perhaps the most famous of Transylvania's 'hidden' villages, gained international attention when King Charles III purchased and restored a traditional Saxon house there. The village's fortified church is a UNESCO World Heritage Site.",
      "Biertan, once the seat of the Lutheran bishopric, boasts one of the most impressive fortified churches in the region. Its massive defensive walls and towers have been remarkably well preserved over the centuries.",
      "Mălâncrav is a painter's dream. Rolling meadows, ancient oak forests, and a 14th-century church with original frescoes make it one of Transylvania's most photogenic destinations.",
      "Rimetea, nestled at the foot of the Trascău Mountains, is unique for its Hungarian-influenced architecture. The village's whitewashed houses with green shutters create a striking visual contrast against the dramatic mountain backdrop.",
      "Șimon, a tiny village near Brașov, offers an intimate experience of traditional Transylvanian life. Its handful of guesthouses provide visitors with home-cooked meals and guided walks through wildflower meadows that remain unchanged for centuries.",
    ],
    subheadings: [
      { title: "Viscri: A Royal Favourite", index: 1 },
      { title: "Biertan: The Bishop's Fortress", index: 2 },
      { title: "Mălâncrav: A Painter's Dream", index: 3 },
      { title: "Rimetea: Mountain Elegance", index: 4 },
    ],
  },
  {
    slug: "babes-bolyai-digital-humanities-program",
    category: "Education",
    title: "Babeș-Bolyai University Launches New Digital Humanities Program",
    author: "Cristian Radu",
    timeAgo: "8 hours ago",
    date: "March 19, 2026",
    excerpt:
      "The prestigious university expands its curriculum with a cutting-edge program blending technology and the liberal arts.",
    image: educationImg,
    body: [
      "The prestigious university expands its curriculum with a cutting-edge program blending technology and the liberal arts. The new Digital Humanities master's program will accept its first cohort of 30 students this autumn.",
      "The program is designed to equip graduates with skills in data analysis, digital archiving, and computational linguistics, all applied to the study of history, literature, and cultural heritage.",
      "Faculty members from both the Computer Science and Philology departments collaborated on the curriculum, which includes courses in machine learning, digital museum curation, and text mining for historical research.",
      "The university has partnered with several Transylvanian museums and archives to provide students with hands-on experience digitising and analysing historical collections. The Brukenthal National Museum in Sibiu is among the key partners.",
      "International interest in the program has been strong, with applications received from across Europe and beyond. The university expects a significant portion of the cohort to be international students.",
      "The launch comes as part of a broader trend in European higher education, where traditional humanities departments are increasingly integrating digital tools and methodologies to remain relevant in a technology-driven world.",
    ],
    subheadings: [
      { title: "A Cross-Disciplinary Curriculum", index: 2 },
      { title: "Museum Partnerships", index: 3 },
    ],
  },
];

export const featuredArticle = articles[0];

export function getArticleBySlug(slug: string): Article | undefined {
  return articles.find((a) => a.slug === slug);
}

export function getArticlesByCategory(category: string): Article[] {
  return articles.filter((a) => a.category.toLowerCase() === category.toLowerCase());
}

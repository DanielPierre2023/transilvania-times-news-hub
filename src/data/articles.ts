import heroImg from "@/assets/hero-transylvania.jpg";
import politicsImg from "@/assets/article-politics.jpg";
import techImg from "@/assets/article-tech.jpg";
import travelImg from "@/assets/article-travel.jpg";
import educationImg from "@/assets/article-education.jpg";

export type Lang = "en" | "ro";
export type BiText = Record<Lang, string>;
export type BiTextArray = Record<Lang, string[]>;

export interface Article {
  slug: string;
  category: BiText;
  title: BiText;
  author: string;
  timeAgo: BiText;
  date: BiText;
  excerpt: BiText;
  image: string;
  body: BiTextArray;
  subheadings?: { title: BiText; index: number }[];
}

/** Helper to read bilingual field with current language */
export function t(field: BiText, lang: string): string {
  const l = lang.startsWith("ro") ? "ro" : "en";
  return field[l] ?? field.en;
}
export function tArr(field: BiTextArray, lang: string): string[] {
  const l = lang.startsWith("ro") ? "ro" : "en";
  return field[l] ?? field.en;
}

export const articles: Article[] = [
  {
    slug: "carpathian-renaissance-transylvania-cultural-destination",
    category: { en: "Travel", ro: "Călătorii" },
    title: {
      en: "The Carpathian Renaissance: How Transylvania Is Becoming Europe's Next Cultural Destination",
      ro: "Renașterea Carpatină: Cum devine Transilvania următoarea destinație culturală a Europei",
    },
    author: "Alexandru Bălan",
    timeAgo: { en: "1 hour ago", ro: "acum 1 oră" },
    date: { en: "March 19, 2026", ro: "19 Martie 2026" },
    excerpt: {
      en: "From underground art galleries in Sibiu to world-class music festivals in Cluj-Napoca, Transylvania is shedding its gothic reputation and emerging as a vibrant hub for contemporary culture, drawing artists, entrepreneurs, and travellers from around the globe.",
      ro: "De la galeriile de artă subterane din Sibiu la festivalurile muzicale de clasă mondială din Cluj-Napoca, Transilvania își pierde reputația gotică și devine un centru vibrant de cultură contemporană, atrăgând artiști, antreprenori și călători din întreaga lume.",
    },
    image: heroImg,
    body: {
      en: [
        "From underground art galleries in Sibiu to world-class music festivals in Cluj-Napoca, Transylvania is shedding its gothic reputation and emerging as a vibrant hub for contemporary culture, drawing artists, entrepreneurs, and travellers from around the globe.",
        "The region's transformation has been decades in the making. After the fall of communism, Transylvania's cities began a slow but steady revival, restoring medieval architecture while simultaneously embracing modern creative movements. Today, that evolution has reached a tipping point.",
        "Sibiu, once a quiet Saxon town, now hosts one of Europe's most respected theatre festivals. Its cobblestone streets are lined with independent galleries, artisan workshops, and cafés that double as performance spaces. The city's designation as a European Capital of Culture in 2007 was a catalyst, but the momentum has only grown since.",
        "Cluj-Napoca, often called the unofficial capital of Transylvania, has become the region's tech and cultural powerhouse. The Electric Castle festival draws over 200,000 attendees annually, while the city's startup ecosystem rivals those of much larger European capitals.",
        "Beyond the cities, rural Transylvania offers a different kind of cultural richness. Fortified churches, many of them UNESCO World Heritage Sites, dot the landscape. Villages like Viscri — famously championed by King Charles III — have become models for sustainable tourism.",
        "Local entrepreneurs are capitalising on this interest, opening boutique guesthouses, organic farms, and craft breweries that celebrate the region's unique heritage while appealing to modern travellers seeking authenticity over luxury.",
        "The Transylvanian renaissance is not without challenges. Infrastructure remains underdeveloped in many rural areas, and there are concerns about over-tourism threatening the very authenticity that draws visitors. Local leaders are working to balance growth with preservation.",
        "Yet the trajectory is clear. With direct flights from major European cities now serving Cluj-Napoca and Sibiu, and a growing international media presence, Transylvania is poised to become one of the continent's most compelling destinations for the culturally curious traveller.",
      ],
      ro: [
        "De la galeriile de artă subterane din Sibiu la festivalurile muzicale de clasă mondială din Cluj-Napoca, Transilvania își pierde reputația gotică și devine un centru vibrant de cultură contemporană, atrăgând artiști, antreprenori și călători din întreaga lume.",
        "Transformarea regiunii a durat decenii. După căderea comunismului, orașele Transilvaniei au început o revigorare lentă dar constantă, restaurând arhitectura medievală și îmbrățișând simultan mișcările creative moderne. Astăzi, evoluția a atins un punct de cotitură.",
        "Sibiul, odată un oraș sas liniștit, găzduiește acum unul dintre cele mai respectate festivaluri de teatru din Europa. Străzile sale cu pavaj din piatră cubică sunt mărginite de galerii independente, ateliere meșteșugărești și cafenele care funcționează și ca spații de spectacol. Desemnarea orașului ca Capitală Europeană a Culturii în 2007 a fost un catalizator, iar impulsul a crescut de atunci.",
        "Cluj-Napoca, adesea numit capitala neoficială a Transilvaniei, a devenit centrul tech și cultural al regiunii. Festivalul Electric Castle atrage peste 200.000 de participanți anual, iar ecosistemul de startup-uri al orașului rivalizează cu cele ale capitalelor europene mult mai mari.",
        "Dincolo de orașe, Transilvania rurală oferă un alt tip de bogăție culturală. Biserici fortificate, multe dintre ele situri UNESCO, punctează peisajul. Sate precum Viscri — susținut de Regele Charles al III-lea — au devenit modele de turism sustenabil.",
        "Antreprenorii locali profită de acest interes, deschizând pensiuni boutique, ferme ecologice și berării artizanale care celebrează moștenirea unică a regiunii, atrăgând călătorii moderni care caută autenticitate în locul luxului.",
        "Renașterea transilvăneană nu este lipsită de provocări. Infrastructura rămâne subdezvoltată în multe zone rurale, iar există preocupări că supra-turismul amenință însăși autenticitatea care atrage vizitatorii. Liderii locali lucrează la echilibrarea creșterii cu conservarea.",
        "Totuși, traiectoria este clară. Cu zboruri directe din marile orașe europene care deservesc acum Cluj-Napoca și Sibiu, și o prezență media internațională în creștere, Transilvania este pe cale să devină una dintre cele mai captivante destinații ale continentului pentru călătorul curios din punct de vedere cultural.",
      ],
    },
    subheadings: [
      { title: { en: "The Rise of Sibiu's Art Scene", ro: "Ascensiunea Scenei Artistice din Sibiu" }, index: 2 },
      { title: { en: "Cluj-Napoca: Tech Meets Culture", ro: "Cluj-Napoca: Tehnologia Întâlnește Cultura" }, index: 3 },
      { title: { en: "Rural Transylvania's Quiet Revolution", ro: "Revoluția Liniștită a Transilvaniei Rurale" }, index: 4 },
      { title: { en: "Challenges and the Road Ahead", ro: "Provocări și Drumul Înainte" }, index: 6 },
    ],
  },
  {
    slug: "opposition-leader-early-elections-public-discontent",
    category: { en: "Politics", ro: "Politică" },
    title: {
      en: "Opposition Leader Calls for Early Elections Amid Growing Public Discontent",
      ro: "Liderul Opoziției solicită alegeri anticipate pe fondul nemulțumirii publice crescânde",
    },
    author: "Elena Popescu",
    timeAgo: { en: "2 hours ago", ro: "acum 2 ore" },
    date: { en: "March 19, 2026", ro: "19 Martie 2026" },
    excerpt: {
      en: "In a fiery address to parliament, the opposition leader demanded snap elections, citing widespread dissatisfaction with the current government's handling of economic reforms and public services.",
      ro: "Într-un discurs aprins în parlament, liderul opoziției a cerut alegeri anticipate, invocând nemulțumirea generalizată față de modul în care guvernul actual gestionează reformele economice și serviciile publice.",
    },
    image: politicsImg,
    body: {
      en: [
        "In a fiery address to parliament, the opposition leader demanded snap elections, citing widespread dissatisfaction with the current government's handling of economic reforms and public services.",
        "The speech, delivered to a packed chamber, drew both applause and jeers. Supporters rallied outside the building, holding signs demanding accountability and transparency from elected officials.",
        "Public opinion polls released this week show that confidence in the ruling coalition has dropped to its lowest point in over a decade. Economic stagnation, rising living costs, and a perceived lack of progress on infrastructure projects have fuelled the discontent.",
        "Political analysts suggest that while early elections remain unlikely under the current constitutional framework, the pressure is mounting. Several coalition partners have publicly expressed reservations about the government's direction.",
        "The opposition has presented a ten-point reform agenda focusing on anti-corruption measures, judicial independence, and accelerated EU integration. Whether these proposals gain traction will depend on the coming weeks of parliamentary debate.",
        "International observers are watching closely. The European Commission has urged all parties to engage in constructive dialogue, emphasising the importance of political stability for ongoing EU accession negotiations.",
      ],
      ro: [
        "Într-un discurs aprins în parlament, liderul opoziției a cerut alegeri anticipate, invocând nemulțumirea generalizată față de modul în care guvernul actual gestionează reformele economice și serviciile publice.",
        "Discursul, rostit într-o sală arhiplină, a atras atât aplauze, cât și huiduieli. Susținătorii s-au adunat în fața clădirii, cu pancarte cerând responsabilitate și transparență din partea oficialilor aleși.",
        "Sondajele de opinie publicate săptămâna aceasta arată că încrederea în coaliția de guvernare a scăzut la cel mai mic nivel din ultimul deceniu. Stagnarea economică, creșterea costului vieții și lipsa percepută de progres în proiectele de infrastructură au alimentat nemulțumirea.",
        "Analiștii politici sugerează că, deși alegerile anticipate rămân puțin probabile în cadrul constituțional actual, presiunea crește. Mai mulți parteneri de coaliție și-au exprimat public rezervele privind direcția guvernului.",
        "Opoziția a prezentat o agendă de reformă în zece puncte, axată pe măsuri anticorupție, independența justiției și integrarea accelerată în UE. Dacă aceste propuneri vor câștiga teren va depinde de săptămânile de dezbateri parlamentare care urmează.",
        "Observatorii internaționali urmăresc cu atenție. Comisia Europeană a îndemnat toate părțile la un dialog constructiv, subliniind importanța stabilității politice pentru negocierile de aderare la UE în desfășurare.",
      ],
    },
    subheadings: [
      { title: { en: "Public Trust at Historic Low", ro: "Încrederea Publică la un Minim Istoric" }, index: 2 },
      { title: { en: "The Opposition's Reform Agenda", ro: "Agenda de Reformă a Opoziției" }, index: 4 },
    ],
  },
  {
    slug: "cluj-napoca-startup-series-a-funding",
    category: { en: "Technology", ro: "Tehnologie" },
    title: {
      en: "Cluj-Napoca Startup Raises €12M in Series A Funding",
      ro: "Un startup din Cluj-Napoca obține 12 milioane € într-o rundă Series A",
    },
    author: "Andrei Moldovan",
    timeAgo: { en: "4 hours ago", ro: "acum 4 ore" },
    date: { en: "March 19, 2026", ro: "19 Martie 2026" },
    excerpt: {
      en: "A promising AI startup based in Cluj-Napoca has secured significant funding to expand its operations across Central and Eastern Europe.",
      ro: "Un startup AI promițător din Cluj-Napoca a obținut o finanțare semnificativă pentru a-și extinde operațiunile în Europa Centrală și de Est.",
    },
    image: techImg,
    body: {
      en: [
        "A promising AI startup based in Cluj-Napoca has secured significant funding to expand its operations across Central and Eastern Europe. The €12 million Series A round was led by a prominent Berlin-based venture capital firm.",
        "The company, which specialises in natural language processing for Eastern European languages, plans to use the funds to triple its engineering team and open offices in Budapest and Warsaw.",
        "Founded in 2023 by two Babeș-Bolyai University graduates, the startup has already attracted clients in the financial services and healthcare sectors. Its flagship product uses advanced machine learning to process and analyse documents in Romanian, Hungarian, and Polish.",
        "The funding round reflects growing international interest in Central and Eastern Europe's tech ecosystem. Cluj-Napoca alone is now home to over 300 tech companies, earning it the nickname 'Silicon Valley of Transylvania.'",
        "Industry experts note that the region's combination of strong technical education, lower operating costs, and EU membership makes it an increasingly attractive destination for tech investment.",
        "The startup's CEO stated that the goal is to become the leading NLP provider for the CEE region within three years, competing with established Western European players by offering superior accuracy for regional languages.",
      ],
      ro: [
        "Un startup AI promițător din Cluj-Napoca a obținut o finanțare semnificativă pentru a-și extinde operațiunile în Europa Centrală și de Est. Runda Series A de 12 milioane € a fost condusă de o firmă de capital de risc de renume din Berlin.",
        "Compania, specializată în procesarea limbajului natural pentru limbile est-europene, plănuiește să utilizeze fondurile pentru a-și tripla echipa de inginerie și a deschide birouri la Budapesta și Varșovia.",
        "Fondată în 2023 de doi absolvenți ai Universității Babeș-Bolyai, startup-ul a atras deja clienți din sectoarele de servicii financiare și sănătate. Produsul său principal utilizează învățarea automată avansată pentru a procesa și analiza documente în română, maghiară și poloneză.",
        "Runda de finanțare reflectă interesul internațional crescând pentru ecosistemul tech din Europa Centrală și de Est. Doar Cluj-Napoca găzduiește peste 300 de companii tech, câștigând porecla de \u201ESilicon Valley al Transilvaniei\u201D.",
        "Experții din industrie observă că combinația regiunii de educație tehnică solidă, costuri operaționale mai mici și apartenența la UE o face o destinație din ce în ce mai atractivă pentru investițiile tech.",
        "CEO-ul startup-ului a declarat că obiectivul este de a deveni liderul NLP pentru regiunea ECE în termen de trei ani, concurând cu jucătorii consacrați din Europa de Vest prin acuratețe superioară pentru limbile regionale.",
      ],
    },
    subheadings: [
      { title: { en: "From University Project to Series A", ro: "De la Proiect Universitar la Series A" }, index: 2 },
      { title: { en: "The CEE Tech Boom", ro: "Boom-ul Tech din ECE" }, index: 3 },
    ],
  },
  {
    slug: "hidden-gems-transylvanian-villages-spring",
    category: { en: "Travel", ro: "Călătorii" },
    title: {
      en: "Hidden Gems: 5 Transylvanian Villages You Must Visit This Spring",
      ro: "Comori Ascunse: 5 Sate Transilvănene de Vizitat în Această Primăvară",
    },
    author: "Maria Ionescu",
    timeAgo: { en: "6 hours ago", ro: "acum 6 ore" },
    date: { en: "March 19, 2026", ro: "19 Martie 2026" },
    excerpt: {
      en: "From rolling hills to medieval fortified churches, these lesser-known villages offer an authentic taste of rural Transylvanian life.",
      ro: "De la coline ondulate la biserici fortificate medievale, aceste sate mai puțin cunoscute oferă o experiență autentică a vieții rurale transilvănene.",
    },
    image: travelImg,
    body: {
      en: [
        "From rolling hills to medieval fortified churches, these lesser-known villages offer an authentic taste of rural Transylvanian life. While tourists flock to Brașov and Sighișoara, these hidden gems remain blissfully uncrowded.",
        "Viscri, perhaps the most famous of Transylvania's 'hidden' villages, gained international attention when King Charles III purchased and restored a traditional Saxon house there. The village's fortified church is a UNESCO World Heritage Site.",
        "Biertan, once the seat of the Lutheran bishopric, boasts one of the most impressive fortified churches in the region. Its massive defensive walls and towers have been remarkably well preserved over the centuries.",
        "Mălâncrav is a painter's dream. Rolling meadows, ancient oak forests, and a 14th-century church with original frescoes make it one of Transylvania's most photogenic destinations.",
        "Rimetea, nestled at the foot of the Trascău Mountains, is unique for its Hungarian-influenced architecture. The village's whitewashed houses with green shutters create a striking visual contrast against the dramatic mountain backdrop.",
        "Șimon, a tiny village near Brașov, offers an intimate experience of traditional Transylvanian life. Its handful of guesthouses provide visitors with home-cooked meals and guided walks through wildflower meadows that remain unchanged for centuries.",
      ],
      ro: [
        "De la coline ondulate la biserici fortificate medievale, aceste sate mai puțin cunoscute oferă o experiență autentică a vieții rurale transilvănene. În timp ce turiștii se îndreaptă spre Brașov și Sighișoara, aceste comori ascunse rămân fericit de neaglomerate.",
        "Viscri, probabil cel mai faimos dintre satele \u201Eascunse\u201D ale Transilvaniei, a câștigat atenția internațională când Regele Charles al III-lea a cumpărat și restaurat o casă tradițională săsească acolo. Biserica fortificată a satului este sit UNESCO.",
        "Biertan, odată sediul episcopiei luterane, se mândrește cu una dintre cele mai impresionante biserici fortificate din regiune. Zidurile sale masive de apărare și turnurile au fost remarcabil de bine conservate de-a lungul secolelor.",
        "Mălâncrav este visul unui pictor. Pajiști ondulate, păduri seculare de stejar și o biserică din secolul al XIV-lea cu fresce originale îl fac una dintre cele mai fotogenice destinații din Transilvania.",
        "Rimetea, situată la poalele Munților Trascău, este unică prin arhitectura sa de influență maghiară. Casele albe cu obloane verzi creează un contrast vizual uimitor pe fundalul dramatic al munților.",
        "Șimon, un sat micuț lângă Brașov, oferă o experiență intimă a vieții tradiționale transilvănene. Cele câteva pensiuni oferă vizitatorilor mese gătite în casă și plimbări ghidate prin pajiștile cu flori sălbatice, neschimbate de secole.",
      ],
    },
    subheadings: [
      { title: { en: "Viscri: A Royal Favourite", ro: "Viscri: Favoritul Regal" }, index: 1 },
      { title: { en: "Biertan: The Bishop's Fortress", ro: "Biertan: Fortăreața Episcopului" }, index: 2 },
      { title: { en: "Mălâncrav: A Painter's Dream", ro: "Mălâncrav: Visul unui Pictor" }, index: 3 },
      { title: { en: "Rimetea: Mountain Elegance", ro: "Rimetea: Eleganță Montană" }, index: 4 },
    ],
  },
  {
    slug: "babes-bolyai-digital-humanities-program",
    category: { en: "Education", ro: "Educație" },
    title: {
      en: "Babeș-Bolyai University Launches New Digital Humanities Program",
      ro: "Universitatea Babeș-Bolyai lansează un nou program de Științe Umaniste Digitale",
    },
    author: "Cristian Radu",
    timeAgo: { en: "8 hours ago", ro: "acum 8 ore" },
    date: { en: "March 19, 2026", ro: "19 Martie 2026" },
    excerpt: {
      en: "The prestigious university expands its curriculum with a cutting-edge program blending technology and the liberal arts.",
      ro: "Prestigioasa universitate își extinde curriculum-ul cu un program de vârf care îmbină tehnologia cu artele liberale.",
    },
    image: educationImg,
    body: {
      en: [
        "The prestigious university expands its curriculum with a cutting-edge program blending technology and the liberal arts. The new Digital Humanities master's program will accept its first cohort of 30 students this autumn.",
        "The program is designed to equip graduates with skills in data analysis, digital archiving, and computational linguistics, all applied to the study of history, literature, and cultural heritage.",
        "Faculty members from both the Computer Science and Philology departments collaborated on the curriculum, which includes courses in machine learning, digital museum curation, and text mining for historical research.",
        "The university has partnered with several Transylvanian museums and archives to provide students with hands-on experience digitising and analysing historical collections. The Brukenthal National Museum in Sibiu is among the key partners.",
        "International interest in the program has been strong, with applications received from across Europe and beyond. The university expects a significant portion of the cohort to be international students.",
        "The launch comes as part of a broader trend in European higher education, where traditional humanities departments are increasingly integrating digital tools and methodologies to remain relevant in a technology-driven world.",
      ],
      ro: [
        "Prestigioasa universitate își extinde curriculum-ul cu un program de vârf care îmbină tehnologia cu artele liberale. Noul program de masterat în Științe Umaniste Digitale va accepta prima cohortă de 30 de studenți în această toamnă.",
        "Programul este conceput pentru a dota absolvenții cu competențe în analiza datelor, arhivarea digitală și lingvistica computațională, toate aplicate în studiul istoriei, literaturii și patrimoniului cultural.",
        "Membrii facultăților de Informatică și Filologie au colaborat la curriculum, care include cursuri de învățare automată, curatoriat digital de muzeu și extragerea textului pentru cercetarea istorică.",
        "Universitatea a încheiat parteneriate cu mai multe muzee și arhive transilvănene pentru a oferi studenților experiență practică în digitalizarea și analizarea colecțiilor istorice. Muzeul Național Brukenthal din Sibiu este printre partenerii cheie.",
        "Interesul internațional pentru program a fost puternic, cu aplicații primite din toată Europa și dincolo de ea. Universitatea se așteaptă ca o porțiune semnificativă a cohortei să fie studenți internaționali.",
        "Lansarea vine ca parte a unei tendințe mai ample în învățământul superior european, unde departamentele tradiționale de umanistică integrează din ce în ce mai mult instrumente și metodologii digitale pentru a rămâne relevante într-o lume condusă de tehnologie.",
      ],
    },
    subheadings: [
      { title: { en: "A Cross-Disciplinary Curriculum", ro: "Un Curriculum Interdisciplinar" }, index: 2 },
      { title: { en: "Museum Partnerships", ro: "Parteneriate cu Muzee" }, index: 3 },
    ],
  },
];

export const featuredArticle = articles[0];

export function getArticleBySlug(slug: string): Article | undefined {
  return articles.find((a) => a.slug === slug);
}

export function getArticlesByCategory(category: string, lang: string): Article[] {
  const l = lang.startsWith("ro") ? "ro" : "en";
  return articles.filter(
    (a) => a.category[l].toLowerCase() === category.toLowerCase() || a.category.en.toLowerCase() === category.toLowerCase()
  );
}

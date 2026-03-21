import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    resources: {
      en: {
        translation: {
          // Header
          breaking: "Breaking",
          support_us: "Support Us",
          search_placeholder: "Search articles...",
          // Categories
          cat_politics: "Politics",
          cat_world: "World",
          cat_technology: "Technology",
          cat_business: "Business",
          cat_culture: "Culture",
          cat_opinion: "Opinion",
          cat_travel: "Travel",
          cat_education: "Education",
          cat_sports: "Sports",
          cat_health: "Health",

          // Breaking headlines
          breaking_1: "Opposition Leader Calls for Early Elections Amid Growing Public Discontent",
          breaking_2: "Cluj-Napoca Startup Raises €12M in Series A Funding",
          breaking_3: "Babeș-Bolyai University Launches New Digital Humanities Program",

          // Index
          latest_stories: "Latest Stories",

          // Article
          go_back: "Go Back to Homepage",
          by_author: "By",

          // Most Read
          most_read: "Most Read",

          // Search
          search_results_for: "Search Results for:",
          articles_found: "article(s) found",
          no_results: "No matching articles found in our archives.",

          // Footer
          footer_description: "Your trusted source for news from the heart of Transylvania and beyond.",
          popular_categories: "Popular Categories",
          contact_us: "Contact Us",
          privacy_policy: "Privacy Policy",
          terms_conditions: "Terms & Conditions",
          copyright: "© 2026 Transilvania Times. All rights reserved.",
          footer_accessibility: "Accessibility",
          footer_company_line: "A media project by ADD Individual Solutions Ltd.",
          footer_editorial_desk: "Editorial Desk",
          footer_corporate_hq: "Corporate Headquarters",

          // Newsletter
          newsletter_title: "Newsletter",
          newsletter_desc: "Don't miss our exclusive news. We never send spam!",
          newsletter_placeholder: "Your email address",
          newsletter_button: "Subscribe Now",
          newsletter_success: "Subscribed successfully!",

          // Blog
          blog_title: "Blog",

          // GDPR
          gdpr_label: "Privacy Policy",
          gdpr_title: "Respecting your privacy in Transilvania.",
          gdpr_desc: "The Transilvania Times and our partners use cookies to store information on your device. We do this to deliver personalized ads, measure traffic, and improve our investigative reporting.",
          gdpr_accept: "Accept All & Read",
          gdpr_essential: "Essential Only",
          gdpr_note: "By clicking \"Accept All\", you help support independent journalism.",
          gdpr_link: "Read our Privacy Policy",

          // Contact page
          contact_label: "Get In Touch",
          contact_title: "Contact Us",
          contact_desc: "Have an investigative tip, a legal inquiry, or just want to say hello? Our Cluj-Napoca desk is ready to hear from you.",
          contact_address: "Address",
          contact_email: "Email",
          contact_phone: "Phone",
          contact_name_label: "Your Name",
          contact_name_placeholder: "John Doe",
          contact_email_label: "Email Address",
          contact_email_placeholder: "you@example.com",
          contact_subject_label: "Subject",
          contact_subject_placeholder: "Investigative Tip / Press Inquiry / General",
          contact_message_label: "Your Message",
          contact_message_placeholder: "Tell us what's on your mind…",
          contact_send: "Send Message",
          contact_toast_title: "Message Sent",
          contact_toast_desc: "Thank you for reaching out. We'll respond within 48 hours.",

          // Terms & Conditions
          terms_legal_label: "Legal Information",
          terms_title: "Terms & Conditions",
          terms_updated: "Last Updated: Thursday, March 19, 2026",
          terms_s1_title: "1. Introduction",
          terms_s1_body: "Welcome to the Transilvania Times. By accessing our news platform, you agree to comply with these terms. We are committed to high-standard journalism and the security of our readers, particularly regarding the digital threats such as phishing and deceptive websites often used by cybercriminals.",
          terms_s2_title: "2. Intellectual Property",
          terms_s2_body: "All content published on this platform, including investigative reports on 5G infrastructure, economic analysis, and political movements, is the property of Transilvania Times. Unauthorized reproduction of our journalism is strictly prohibited.",
          terms_s3_title: "3. Advertising & Data",
          terms_s3_body: "To support our independent journalism, we utilize Google AdSense to serve advertisements. These ads may be tailored based on your interactions. For more details on your choices and our compliance with European GDPR laws, please refer to our Privacy Policy and the Consent Management banner.",
          terms_s4_title: "4. User Conduct",
          terms_s4_body: "Users must not use this site for any fraudulent purposes or to distribute malware. We actively fortify our essential systems to ensure that our readers remain protected in an ever-changing digital threat landscape.",
          terms_contact_title: "Contact Our Legal Desk",
          terms_hq: "ADD Individual Solutions Ltd.",
          terms_reg: "Registration",
          terms_back: "Back to Homepage",

          // Privacy Policy
          privacy_legal_label: "Legal Information",
          privacy_title: "Privacy Policy",
          privacy_updated: "Last Updated: Thursday, March 19, 2026",
          privacy_s1_title: "1. Information We Collect",
          privacy_s1_body: "We collect information you provide directly, such as your email address when subscribing to our newsletter. We also automatically collect certain data through cookies and similar technologies, including your IP address, browser type, device information, and browsing behaviour on our platform.",
          privacy_s2_title: "2. Cookies & Tracking Technologies",
          privacy_s2_body: "The Transilvania Times uses cookies to enhance your reading experience, remember your preferences, and deliver relevant advertisements through Google AdSense. Essential cookies are required for the site to function. Advertising cookies are only activated after you grant consent via our Consent Management banner.",
          privacy_s3_title: "3. How We Use Your Data",
          privacy_s3_body: "Your data is used to operate and improve the Transilvania Times, deliver personalised content and advertisements, analyse traffic patterns, and comply with legal obligations. We never sell your personal data to third parties.",
          privacy_s4_title: "4. Third-Party Services",
          privacy_s4_body: "We partner with Google AdSense to serve advertisements. Google may use cookies to serve ads based on your prior visits to our site or other websites. You can opt out of personalised advertising by visiting Google's Ad Settings. We also use the Open-Meteo API for weather data, which does not collect personal information.",
          privacy_s5_title: "5. Your Rights Under GDPR",
          privacy_s5_body: "As a reader in the European Union, you have the right to access, rectify, or delete your personal data. You may withdraw consent for non-essential cookies at any time by clearing your browser's local storage. To exercise any of these rights, contact our Data Protection team at the address below.",
          privacy_s6_title: "6. Data Retention",
          privacy_s6_body: "We retain your personal data only for as long as necessary to fulfil the purposes outlined in this policy. Cookie consent preferences are stored locally on your device and are not transmitted to our servers.",
          privacy_s7_title: "7. Changes to This Policy",
          privacy_s7_body: "We may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated revision date. We encourage you to review this policy periodically.",
          privacy_contact_title: "Contact Our Data Protection Team",
          privacy_dpa: "Lead Data Protection Authority: Commissioner for Personal Data Protection, Cyprus.",
          privacy_back: "Back to Homepage",

          // Category page
          all_articles: "All Articles",

          // Comments & Sharing
          comments_title: "Discussion & Comments",
          comments_name: "Your Name",
          comments_email: "Email (optional)",
          comments_placeholder: "Share your thoughts…",
          comments_submit: "Post Comment",
          comments_pending: "Comment submitted! It will appear after moderation.",
          comments_none: "Be the first to comment on this article.",
          share_label: "Share",
        },
      },
      ro: {
        translation: {
          // Header
          breaking: "Ultima Oră",
          support_us: "Susține-ne",
          search_placeholder: "Caută articole...",
          // Categories
          cat_politics: "Politică",
          cat_world: "Lume",
          cat_technology: "Tehnologie",
          cat_business: "Afaceri",
          cat_culture: "Cultură",
          cat_opinion: "Opinie",
          cat_travel: "Călătorii",
          cat_education: "Educație",
          cat_sports: "Sport",
          cat_health: "Sănătate",

          // Breaking headlines
          breaking_1: "Liderul Opoziției solicită alegeri anticipate pe fondul nemulțumirii publice crescânde",
          breaking_2: "Un startup din Cluj-Napoca obține 12 milioane € într-o rundă de finanțare Series A",
          breaking_3: "Universitatea Babeș-Bolyai lansează un nou program de Științe Umaniste Digitale",

          // Index
          latest_stories: "Ultimele Știri",

          // Article
          go_back: "Înapoi la Pagina Principală",
          by_author: "De",

          // Most Read
          most_read: "Cele Mai Citite",

          // Search
          search_results_for: "Rezultate pentru:",
          articles_found: "articol(e) găsite",
          no_results: "Nu am găsit articole în arhiva noastră.",

          // Footer
          footer_description: "Sursa dumneavoastră de încredere pentru știri din inima Transilvaniei și nu numai.",
          popular_categories: "Categorii Populare",
          contact_us: "Contactează-ne",
          privacy_policy: "Politica de Confidențialitate",
          terms_conditions: "Termeni și Condiții",
          copyright: "© 2026 Transilvania Times. Toate drepturile rezervate.",
          footer_accessibility: "Accesibilitate",
          footer_company_line: "Un proiect media al ADD Individual Solutions Ltd.",
          footer_editorial_desk: "Redacția Editorială",
          footer_corporate_hq: "Sediul Social",

          // Newsletter
          newsletter_title: "Buletin Informativ",
          newsletter_desc: "Nu rata știrile noastre exclusive. Nu trimitem spam!",
          newsletter_placeholder: "Adresa ta de email",
          newsletter_button: "Abonează-te Acum",
          newsletter_success: "Te-ai abonat cu succes!",

          // Blog
          blog_title: "Blog",

          // GDPR
          gdpr_label: "Politica de Confidențialitate",
          gdpr_title: "Respectăm confidențialitatea ta în Transilvania.",
          gdpr_desc: "Transilvania Times și partenerii noștri utilizează module cookie pentru a stoca informații pe dispozitivul dumneavoastră. Facem acest lucru pentru a livra reclame personalizate, a măsura traficul și a îmbunătăți reportajele noastre de investigație.",
          gdpr_accept: "Acceptă Tot și Citește",
          gdpr_essential: "Doar Esențiale",
          gdpr_note: "Apăsând \u201EAcceptă Tot\u201D, susții jurnalismul independent.",
          gdpr_link: "Citește Politica de Confidențialitate",

          // Contact page
          contact_label: "Ia Legătura",
          contact_title: "Contactează-ne",
          contact_desc: "Ai un pont de investigație, o solicitare legală sau vrei doar să ne saluti? Biroul nostru din Cluj-Napoca te așteaptă.",
          contact_address: "Adresă",
          contact_email: "Email",
          contact_phone: "Telefon",
          contact_name_label: "Numele Tău",
          contact_name_placeholder: "Ion Popescu",
          contact_email_label: "Adresă de Email",
          contact_email_placeholder: "tu@exemplu.com",
          contact_subject_label: "Subiect",
          contact_subject_placeholder: "Pont de Investigație / Solicitare Presă / General",
          contact_message_label: "Mesajul Tău",
          contact_message_placeholder: "Spune-ne ce ai pe suflet…",
          contact_send: "Trimite Mesajul",
          contact_toast_title: "Mesaj Trimis",
          contact_toast_desc: "Mulțumim că ne-ai contactat. Vom răspunde în 48 de ore.",

          // Terms & Conditions
          terms_legal_label: "Informații Legale",
          terms_title: "Termeni și Condiții",
          terms_updated: "Ultima actualizare: Joi, 19 Martie 2026",
          terms_s1_title: "1. Introducere",
          terms_s1_body: "Bine ați venit la Transilvania Times. Prin accesarea platformei noastre de știri, sunteți de acord să respectați acești termeni. Ne angajăm să oferim jurnalism de înaltă calitate și să asigurăm securitatea cititorilor noștri, în special în ceea ce privește amenințările digitale, cum ar fi phishing-ul.",
          terms_s2_title: "2. Proprietate Intelectuală",
          terms_s2_body: "Toate materialele publicate pe această platformă, inclusiv rapoartele de investigație privind infrastructura 5G, analizele economice și mișcările politice, sunt proprietatea Transilvania Times. Reproducerea neautorizată a jurnalismului nostru este strict interzisă.",
          terms_s3_title: "3. Publicitate și Date",
          terms_s3_body: "Pentru a susține jurnalismul nostru independent, utilizăm Google AdSense pentru a afișa reclame. Acestea pot fi personalizate în funcție de interacțiunile dumneavoastră. Pentru detalii privind conformitatea noastră cu legile europene GDPR, vă rugăm să consultați Politica de Confidențialitate.",
          terms_s4_title: "4. Conduita Utilizatorilor",
          terms_s4_body: "Utilizatorii nu trebuie să folosească acest site în scopuri frauduloase sau pentru a distribui programe malware. Ne fortificăm activ sistemele esențiale pentru a ne asigura că cititorii noștri rămân protejați într-un peisaj digital în continuă schimbare.",
          terms_contact_title: "Contactați Biroul Legal",
          terms_hq: "Sediul Transilvania Times",
          terms_back: "Înapoi la Pagina Principală",

          // Privacy Policy
          privacy_legal_label: "Informații Legale",
          privacy_title: "Politica de Confidențialitate",
          privacy_updated: "Ultima actualizare: Joi, 19 Martie 2026",
          privacy_s1_title: "1. Informațiile pe Care le Colectăm",
          privacy_s1_body: "Colectăm informațiile pe care ni le furnizați direct, cum ar fi adresa de email la abonarea la buletinul nostru informativ. De asemenea, colectăm automat anumite date prin cookie-uri și tehnologii similare, inclusiv adresa IP, tipul browserului, informații despre dispozitiv și comportamentul de navigare pe platforma noastră.",
          privacy_s2_title: "2. Cookie-uri și Tehnologii de Urmărire",
          privacy_s2_body: "Transilvania Times folosește cookie-uri pentru a îmbunătăți experiența de citire, a reține preferințele dumneavoastră și a livra reclame relevante prin Google AdSense. Cookie-urile esențiale sunt necesare pentru funcționarea site-ului. Cookie-urile publicitare sunt activate doar după ce acordați consimțământul prin bannerul nostru de gestionare a consimțământului.",
          privacy_s3_title: "3. Cum Folosim Datele Dumneavoastră",
          privacy_s3_body: "Datele dumneavoastră sunt utilizate pentru a opera și îmbunătăți Transilvania Times, a livra conținut personalizat și reclame, a analiza tiparele de trafic și a respecta obligațiile legale. Nu vindem niciodată datele dumneavoastră personale către terți.",
          privacy_s4_title: "4. Servicii Terțe",
          privacy_s4_body: "Colaborăm cu Google AdSense pentru a difuza reclame. Google poate utiliza cookie-uri pentru a difuza anunțuri pe baza vizitelor anterioare pe site-ul nostru sau pe alte site-uri. Puteți renunța la publicitatea personalizată accesând Setările de Reclame Google. De asemenea, utilizăm API-ul Open-Meteo pentru date meteorologice, care nu colectează informații personale.",
          privacy_s5_title: "5. Drepturile Dumneavoastră conform GDPR",
          privacy_s5_body: "Ca cititor din Uniunea Europeană, aveți dreptul de a accesa, rectifica sau șterge datele dumneavoastră personale. Puteți retrage consimțământul pentru cookie-urile neesențiale în orice moment, ștergând stocarea locală a browserului. Pentru a exercita oricare dintre aceste drepturi, contactați echipa noastră de Protecție a Datelor la adresa de mai jos.",
          privacy_s6_title: "6. Retenția Datelor",
          privacy_s6_body: "Păstrăm datele dumneavoastră personale doar atât timp cât este necesar pentru a îndeplini scopurile descrise în această politică. Preferințele de consimțământ pentru cookie-uri sunt stocate local pe dispozitivul dumneavoastră și nu sunt transmise către serverele noastre.",
          privacy_s7_title: "7. Modificări ale Acestei Politici",
          privacy_s7_body: "Putem actualiza această Politică de Confidențialitate din când în când. Orice modificări vor fi publicate pe această pagină cu o dată de revizuire actualizată. Vă încurajăm să revizuiți periodic această politică.",
          privacy_contact_title: "Contactați Echipa de Protecție a Datelor",
          privacy_back: "Înapoi la Pagina Principală",

          // Category page
          all_articles: "Toate Articolele",

          // Comments & Sharing
          comments_title: "Discuții și Comentarii",
          comments_name: "Numele tău",
          comments_email: "Email (opțional)",
          comments_placeholder: "Împărtășește-ți gândurile…",
          comments_submit: "Postează comentariu",
          comments_pending: "Comentariu trimis! Va apărea după moderare.",
          comments_none: "Fii primul care comentează acest articol.",
          share_label: "Distribuie",
        },
      },
    },
  });

export default i18n;

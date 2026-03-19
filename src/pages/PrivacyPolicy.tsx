import { Link } from "react-router-dom";
import Header from "@/components/Header";
import Newsletter from "@/components/Newsletter";
import Footer from "@/components/Footer";

const sections = [
  {
    title: "1. Information We Collect",
    body: "We collect information you provide directly, such as your email address when subscribing to our newsletter. We also automatically collect certain data through cookies and similar technologies, including your IP address, browser type, device information, and browsing behaviour on our platform.",
  },
  {
    title: "2. Cookies & Tracking Technologies",
    body: "The Transilvania Times uses cookies to enhance your reading experience, remember your preferences, and deliver relevant advertisements through Google AdSense. Essential cookies are required for the site to function. Advertising cookies are only activated after you grant consent via our Consent Management banner.",
  },
  {
    title: "3. How We Use Your Data",
    body: "Your data is used to operate and improve the Transilvania Times, deliver personalised content and advertisements, analyse traffic patterns, and comply with legal obligations. We never sell your personal data to third parties.",
  },
  {
    title: "4. Third-Party Services",
    body: "We partner with Google AdSense to serve advertisements. Google may use cookies to serve ads based on your prior visits to our site or other websites. You can opt out of personalised advertising by visiting Google's Ad Settings. We also use the Open-Meteo API for weather data, which does not collect personal information.",
  },
  {
    title: "5. Your Rights Under GDPR",
    body: "As a reader in the European Union, you have the right to access, rectify, or delete your personal data. You may withdraw consent for non-essential cookies at any time by clearing your browser's local storage. To exercise any of these rights, contact our Data Protection team at the address below.",
  },
  {
    title: "6. Data Retention",
    body: "We retain your personal data only for as long as necessary to fulfil the purposes outlined in this policy. Cookie consent preferences are stored locally on your device and are not transmitted to our servers.",
  },
  {
    title: "7. Changes to This Policy",
    body: "We may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated revision date. We encourage you to review this policy periodically.",
  },
];

const PrivacyPolicy = () => (
  <div className="min-h-screen bg-background">
    <Header />

    <main className="max-w-4xl mx-auto px-5 py-16">
      <header className="mb-12">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 bg-primary" />
          <span className="text-primary font-sans font-bold text-[10px] uppercase tracking-[0.2em]">
            Legal Information
          </span>
        </div>
        <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground leading-tight italic tracking-tighter">
          Privacy Policy
        </h1>
        <p className="text-muted-foreground font-sans text-sm mt-4">
          Last Updated: Thursday, March 19, 2026
        </p>
      </header>

      <div className="space-y-10 font-sans text-foreground/90 text-lg leading-relaxed">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="text-xl font-serif font-bold text-foreground mb-3">
              {s.title}
            </h2>
            <p>{s.body}</p>
          </section>
        ))}

        <section className="border-t border-foreground/10 pt-10">
          <h2 className="text-xl font-serif font-bold text-foreground mb-3">
            Contact Our Data Protection Team
          </h2>
          <div className="text-base space-y-1">
            <p className="font-bold">Transilvania Times HQ</p>
            <p>str. Memorandumului nr 2</p>
            <p>Cluj-Napoca, Transilvania</p>
            <p className="mt-3">
              Email:{" "}
              <a
                href="mailto:privacy@transilvaniatimes.com"
                className="text-primary hover:underline"
              >
                privacy@transilvaniatimes.com
              </a>
            </p>
          </div>
        </section>
      </div>

      <div className="mt-16 flex justify-center md:justify-start">
        <Link
          to="/"
          className="bg-primary text-primary-foreground px-10 py-4 font-bold uppercase tracking-tight hover:bg-accent transition-all"
        >
          Back to Homepage
        </Link>
      </div>
    </main>

    <Newsletter />
    <Footer />
  </div>
);

export default PrivacyPolicy;

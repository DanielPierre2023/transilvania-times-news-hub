import { Link } from "react-router-dom";
import Header from "@/components/Header";
import Newsletter from "@/components/Newsletter";
import Footer from "@/components/Footer";

const sections = [
  {
    title: "1. Introduction",
    body: "Welcome to the Transilvania Times. By accessing our news platform, you agree to comply with these terms. We are committed to high-standard journalism and the security of our readers, particularly regarding the digital threats such as phishing and deceptive websites often used by cybercriminals.",
  },
  {
    title: "2. Intellectual Property",
    body: "All content published on this platform, including investigative reports on 5G infrastructure, economic analysis, and political movements, is the property of Transilvania Times. Unauthorized reproduction of our journalism is strictly prohibited.",
  },
  {
    title: "3. Advertising & Data",
    body: 'To support our independent journalism, we utilize Google AdSense to serve advertisements. These ads may be tailored based on your interactions. For more details on your choices and our compliance with European GDPR laws, please refer to our Privacy Policy and the Consent Management banner.',
  },
  {
    title: "4. User Conduct",
    body: "Users must not use this site for any fraudulent purposes or to distribute malware. We actively fortify our essential systems to ensure that our readers remain protected in an ever-changing digital threat landscape.",
  },
];

const TermsConditions = () => (
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
          Terms &amp; Conditions
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
            Contact Our Legal Desk
          </h2>
          <div className="text-base space-y-1">
            <p className="font-bold">Transilvania Times HQ</p>
            <p>str. Memorandumului nr 2</p>
            <p>Cluj-Napoca, Transilvania</p>
            <p className="mt-3">
              Email:{" "}
              <a
                href="mailto:needhelp@transilvaniatimes.com"
                className="text-primary hover:underline"
              >
                needhelp@transilvaniatimes.com
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

export default TermsConditions;

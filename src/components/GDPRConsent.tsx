import { useState, useEffect } from "react";

const GDPRConsent = () => {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("transilvania-consent");
    if (!consent) {
      const timer = setTimeout(() => setShowBanner(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleConsent = (level: "all" | "essential") => {
    localStorage.setItem("transilvania-consent", level);
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 w-full z-[9999] p-4 md:p-8 animate-slide-up safe-p-bottom">
      <div className="max-w-4xl mx-auto bg-background border-2 border-foreground shadow-[20px_20px_0px_0px_hsl(var(--foreground)/0.1)] p-6 md:p-10 flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-primary" />
            <span className="text-primary font-sans font-bold text-[10px] uppercase tracking-[0.2em]">
              Privacy Policy
            </span>
          </div>
          <h2 className="text-2xl font-serif font-bold text-foreground leading-tight italic">
            Respecting your privacy in Transilvania.
          </h2>
          <p className="text-muted-foreground font-sans text-sm leading-relaxed">
            The Transilvania Times and our partners use cookies to store
            information on your device. We do this to deliver personalized ads,
            measure traffic, and improve our investigative reporting.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <button
            onClick={() => handleConsent("all")}
            className="flex-1 bg-primary text-primary-foreground py-4 font-bold uppercase text-xs tracking-widest hover:bg-accent transition-all"
          >
            Accept All & Read
          </button>
          <button
            onClick={() => handleConsent("essential")}
            className="flex-1 border border-foreground/20 text-foreground py-4 font-bold uppercase text-xs tracking-widest hover:bg-foreground hover:text-background transition-all"
          >
            Essential Only
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground/60 font-sans text-center md:text-left">
          By clicking "Accept All", you help support independent journalism.
        </p>
      </div>
    </div>
  );
};

export default GDPRConsent;

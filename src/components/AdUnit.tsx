import { useEffect, useState } from "react";

type AdType = "leaderboard" | "sidebar" | "infeed";

interface AdUnitProps {
  type: AdType;
  slot?: string;
  className?: string;
}

const dimensions: Record<AdType, string> = {
  leaderboard: "min-h-[90px] w-full max-w-[728px]",
  sidebar: "min-h-[600px] w-full max-w-[300px]",
  infeed: "min-h-[250px] w-full",
};

const AdUnit = ({ type, slot, className = "" }: AdUnitProps) => {
  const [hasConsent, setHasConsent] = useState(false);

  useEffect(() => {
    setHasConsent(localStorage.getItem("transilvania-consent") === "all");
  }, []);

  return (
    <div className={`ad-wrapper flex flex-col items-center my-8 ${className}`}>
      <span className="text-[9px] font-sans font-bold text-muted-foreground uppercase tracking-[0.2em] mb-2">
        Advertisement
      </span>
      <div
        className={`bg-foreground/[0.03] border border-foreground/5 overflow-hidden flex items-center justify-center ${dimensions[type]}`}
      >
        {hasConsent && slot ? (
          <ins
            className="adsbygoogle"
            style={{ display: "block" }}
            data-ad-client="ca-pub-YOUR_ID_HERE"
            data-ad-slot={slot}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        ) : (
          <span className="text-muted-foreground/40 font-sans text-xs italic">
            Ad Placeholder
          </span>
        )}
      </div>
    </div>
  );
};

export default AdUnit;

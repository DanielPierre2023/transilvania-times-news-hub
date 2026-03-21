import React from "react";
import { useTranslation } from "react-i18next";

const LangSwitcher = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, ref) => {
    const { i18n } = useTranslation();
    const lang = i18n.language?.startsWith("ro") ? "ro" : "en";

    return (
      <div ref={ref} {...props} className="flex gap-2 font-sans text-[10px] font-bold tracking-widest border-r border-foreground/10 pr-3 mr-3">
        <button
          onClick={() => i18n.changeLanguage("ro")}
          className={`hover:text-primary transition-colors pb-0.5 ${lang === "ro" ? "text-primary border-b border-primary" : "text-muted-foreground"}`}
        >
          RO
        </button>
        <button
          onClick={() => i18n.changeLanguage("en")}
          className={`hover:text-primary transition-colors pb-0.5 ${lang === "en" ? "text-primary border-b border-primary" : "text-muted-foreground"}`}
        >
          EN
        </button>
      </div>
    );
  }
);

LangSwitcher.displayName = "LangSwitcher";

export default LangSwitcher;

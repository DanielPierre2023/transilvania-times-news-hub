import { Facebook, Linkedin, MessageCircle, Share2, Twitter } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ShareSuiteProps {
  title: string;
  url: string;
  summary?: string;
  tags?: string[];
  sticky?: boolean;
}

const ShareSuite = ({ title, url, summary = "", tags = [], sticky = false }: ShareSuiteProps) => {
  const { t } = useTranslation();
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const hashtags = tags.map(tag => tag.replace(/[^a-zA-Z0-9]/g, "")).join(",");

  const shareLinks = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    twitter: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}${hashtags ? `&hashtags=${hashtags}` : ""}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    whatsapp: `https://api.whatsapp.com/send?text=${encodedTitle}%20${encodedUrl}`,
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: summary, url });
      } catch {
        /* user cancelled */
      }
    }
  };

  const IconLink = ({ href, children, label }: { href: string; children: React.ReactNode; label: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="w-10 h-10 flex items-center justify-center rounded-full border border-espresso/10 text-espresso hover:bg-espresso hover:text-paper transition-all duration-300"
    >
      {children}
    </a>
  );

  if (sticky) {
    return (
      <div className="fixed bottom-0 left-0 w-full bg-paper/95 backdrop-blur-md border-t border-espresso/10 p-3 md:hidden z-50 animate-slide-up safe-p-bottom">
        <div className="max-w-7xl mx-auto flex items-center justify-around">
          <IconLink href={shareLinks.facebook} label="Share on Facebook"><Facebook size={18} /></IconLink>
          <IconLink href={shareLinks.twitter} label="Share on X"><Twitter size={18} /></IconLink>
          <IconLink href={shareLinks.linkedin} label="Share on LinkedIn"><Linkedin size={18} /></IconLink>
          <IconLink href={shareLinks.whatsapp} label="Share on WhatsApp"><MessageCircle size={18} /></IconLink>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <button
              onClick={handleNativeShare}
              aria-label="Share"
              className="w-10 h-10 flex items-center justify-center rounded-full bg-brand-red text-paper hover:bg-action-orange transition-all duration-300"
            >
              <Share2 size={18} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-4 border-b border-espresso/5 mb-6">
      <span className="text-[10px] font-bold uppercase tracking-widest text-clay mr-2 hidden sm:inline">
        {t("share_label")}:
      </span>
      <IconLink href={shareLinks.facebook} label="Share on Facebook"><Facebook size={18} /></IconLink>
      <IconLink href={shareLinks.twitter} label="Share on X"><Twitter size={18} /></IconLink>
      <IconLink href={shareLinks.linkedin} label="Share on LinkedIn"><Linkedin size={18} /></IconLink>
      <IconLink href={shareLinks.whatsapp} label="Share on WhatsApp"><MessageCircle size={18} /></IconLink>
      {typeof navigator !== "undefined" && "share" in navigator && (
        <button
          onClick={handleNativeShare}
          aria-label="Share"
          className="w-10 h-10 flex items-center justify-center rounded-full bg-brand-red text-paper hover:bg-action-orange transition-all duration-300"
        >
          <Share2 size={18} />
        </button>
      )}
    </div>
  );
};

export default ShareSuite;

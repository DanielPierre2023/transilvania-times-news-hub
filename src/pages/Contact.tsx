import { useState } from "react";
import { Mail, Phone, MapPin, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import Header from "@/components/Header";
import Newsletter from "@/components/Newsletter";
import Footer from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";

const Contact = () => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({ title: t("contact_toast_title"), description: t("contact_toast_desc") });
    setForm({ name: "", email: "", subject: "", message: "" });
  };

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-6xl mx-auto px-5 py-16">
        <header className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 bg-primary" />
            <span className="text-primary font-sans font-bold text-[10px] uppercase tracking-[0.2em]">
              {t("contact_label")}
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground leading-tight italic tracking-tighter">
            {t("contact_title")}
          </h1>
          <p className="text-muted-foreground font-sans text-sm mt-4 max-w-xl">
            {t("contact_desc")}
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-12">
          {/* Left — Contact Info */}
          <div className="md:col-span-2 space-y-8">
            <div className="flex gap-4">
              <MapPin className="w-5 h-5 text-primary mt-1 shrink-0" />
              <div>
                <h3 className="font-sans font-bold text-foreground text-sm uppercase tracking-wider mb-1">{t("contact_address")}</h3>
                <p className="text-muted-foreground text-sm font-sans">str. Memorandumului nr 2</p>
                <p className="text-muted-foreground text-sm font-sans">Cluj-Napoca, Transilvania</p>
              </div>
            </div>

            <div className="flex gap-4">
              <Mail className="w-5 h-5 text-primary mt-1 shrink-0" />
              <div>
                <h3 className="font-sans font-bold text-foreground text-sm uppercase tracking-wider mb-1">{t("contact_email")}</h3>
                <a href="mailto:needhelp@transilvaniatimes.com" className="text-primary text-sm font-sans hover:underline block">
                  needhelp@transilvaniatimes.com
                </a>
                <a href="mailto:press@transilvaniatimes.com" className="text-primary text-sm font-sans hover:underline block">
                  press@transilvaniatimes.com
                </a>
              </div>
            </div>

            <div className="flex gap-4">
              <Phone className="w-5 h-5 text-primary mt-1 shrink-0" />
              <div>
                <h3 className="font-sans font-bold text-foreground text-sm uppercase tracking-wider mb-1">{t("contact_phone")}</h3>
                <p className="text-muted-foreground text-sm font-sans">+40 264 123 456</p>
              </div>
            </div>
          </div>

          {/* Right — Form */}
          <form onSubmit={handleSubmit} className="md:col-span-3 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block font-sans text-xs font-bold uppercase tracking-wider text-foreground mb-2">{t("contact_name_label")}</label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={form.name}
                  onChange={update("name")}
                  placeholder={t("contact_name_placeholder")}
                  className="w-full bg-background border border-border p-4 font-sans text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="block font-sans text-xs font-bold uppercase tracking-wider text-foreground mb-2">{t("contact_email_label")}</label>
                <input
                  type="email"
                  required
                  maxLength={255}
                  value={form.email}
                  onChange={update("email")}
                  placeholder={t("contact_email_placeholder")}
                  className="w-full bg-background border border-border p-4 font-sans text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block font-sans text-xs font-bold uppercase tracking-wider text-foreground mb-2">{t("contact_subject_label")}</label>
              <input
                type="text"
                required
                maxLength={200}
                value={form.subject}
                onChange={update("subject")}
                placeholder={t("contact_subject_placeholder")}
                className="w-full bg-background border border-border p-4 font-sans text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div>
              <label className="block font-sans text-xs font-bold uppercase tracking-wider text-foreground mb-2">{t("contact_message_label")}</label>
              <textarea
                required
                maxLength={2000}
                rows={6}
                value={form.message}
                onChange={update("message")}
                placeholder={t("contact_message_placeholder")}
                className="w-full bg-background border border-border p-4 font-sans text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors resize-none"
              />
            </div>

            <button
              type="submit"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-10 py-4 font-sans font-bold uppercase tracking-tight hover:bg-accent active:scale-95 transition-all"
            >
              <Send className="w-4 h-4" />
              {t("contact_send")}
            </button>
          </form>
        </div>
      </main>

      <Newsletter />
      <Footer />
    </div>
  );
};

export default Contact;

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { z } from "zod";

const commentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  content: z.string().trim().min(3).max(2000),
});

interface CommentSectionProps {
  postId: string;
  postTitle?: string;
  postExcerpt?: string;
}

const CommentSection = ({ postId, postTitle = "", postExcerpt = "" }: CommentSectionProps) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [content, setContent] = useState("");

  const { data: comments = [] } = useQuery({
    queryKey: ["public_comments", postId],
    queryFn: async () => {
      const { data } = await supabase
        .from("blog_comments_public")
        .select("*")
        .eq("post_id", postId)
        .order("created_at", { ascending: true });
      return data || [];
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const parsed = commentSchema.parse({ name, email: email || undefined, content });

      const insertData: any = {
        post_id: postId,
        author_name: parsed.name,
        content: parsed.content,
        status: "pending",
      };
      if (parsed.email) insertData.author_email = parsed.email;

      const { error } = await supabase.from("blog_comments").insert(insertData);
      if (error) throw error;

      // Fire AI reply generation (fire-and-forget)
      supabase.functions.invoke("ai-comment-reply", {
        body: {
          comment_content: parsed.content,
          post_title: postTitle,
          post_excerpt: postExcerpt,
          language: i18n.language.startsWith("ro") ? "ro" : "en",
        },
      }).catch(() => {});
    },
    onSuccess: () => {
      toast.success(t("comments_pending"));
      setName("");
      setEmail("");
      setContent("");
      qc.invalidateQueries({ queryKey: ["public_comments", postId] });
    },
    onError: (e: any) => {
      if (e instanceof z.ZodError) {
        toast.error("Please check your input.");
      } else {
        toast.error(e.message || "Failed to submit comment.");
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitMutation.mutate();
  };

  return (
    <section className="mt-16 border-t-2 border-espresso pt-10">
      <h3 className="font-serif italic text-3xl mb-8 text-foreground">{t("comments_title")}</h3>

      {/* Comment list */}
      {comments.length === 0 ? (
        <p className="text-clay text-sm mb-10">{t("comments_none")}</p>
      ) : (
        <div className="space-y-6 mb-10">
          {comments.map((c) => (
            <div key={c.id} className="border-l-2 border-espresso/20 pl-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-sans font-bold text-sm text-foreground">{c.author_name}</span>
                {c.created_at && (
                  <span className="text-xs text-clay">{format(parseISO(c.created_at), "MMM dd, yyyy")}</span>
                )}
              </div>
              <p className="text-sm text-foreground font-sans leading-relaxed">{c.content}</p>

              {c.ai_reply && (
                <div className="mt-3 ml-4 p-3 bg-espresso/5 rounded-sm">
                  <p className="text-xs font-bold text-clay mb-1">
                    <MessageCircle className="w-3 h-3 inline mr-1" />
                    Transilvania Times
                  </p>
                  <p className="text-sm text-foreground font-sans">{c.ai_reply}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Comment form */}
      <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            placeholder={t("comments_name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            className="border-espresso/20 bg-paper"
          />
          <Input
            type="email"
            placeholder={t("comments_email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={255}
            className="border-espresso/20 bg-paper"
          />
        </div>
        <Textarea
          placeholder={t("comments_placeholder")}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          maxLength={2000}
          rows={4}
          className="border-espresso/20 bg-paper"
        />
        <Button
          type="submit"
          disabled={submitMutation.isPending}
          className="bg-espresso text-paper hover:bg-brand-red transition-all"
        >
          <Send className="w-4 h-4 mr-2" />
          {t("comments_submit")}
        </Button>
      </form>
    </section>
  );
};

export default CommentSection;

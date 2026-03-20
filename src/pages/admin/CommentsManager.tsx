import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';
import { Check, Trash2, RefreshCw, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

const CommentsManager = () => {
  const qc = useQueryClient();

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['admin_comments'],
    queryFn: async () => {
      const { data } = await supabase
        .from('blog_comments')
        .select('*')
        .order('status', { ascending: true })
        .order('created_at', { ascending: false });
      return data || [];
    },
  });

  const { data: posts = [] } = useQuery({
    queryKey: ['admin_posts_titles'],
    queryFn: async () => {
      const { data } = await supabase.from('blog_posts').select('id, title_en, title_ro, slug');
      return data || [];
    },
  });

  const postMap = Object.fromEntries(posts.map(p => [p.id, p]));

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('blog_comments').update({ status: 'approved' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin_comments'] }); toast.success('Comment approved'); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('blog_comments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin_comments'] }); toast.success('Comment deleted'); },
    onError: (e: any) => toast.error(e.message),
  });

  const regenerateReply = useMutation({
    mutationFn: async (comment: any) => {
      const post = postMap[comment.post_id];
      const { data, error } = await supabase.functions.invoke('ai-comment-reply', {
        body: {
          comment_content: comment.content,
          post_title: post?.title_en || 'Blog Post',
          post_excerpt: '',
          language: 'en',
        },
      });
      if (error) throw error;
      const { error: updateErr } = await supabase.from('blog_comments').update({ ai_reply: data.reply }).eq('id', comment.id);
      if (updateErr) throw updateErr;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin_comments'] }); toast.success('AI reply regenerated'); },
    onError: (e: any) => toast.error(e.message),
  });

  const pending = comments.filter(c => c.status === 'pending');
  const approved = comments.filter(c => c.status === 'approved');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold text-foreground">Comments</h1>
        <p className="text-sm text-muted-foreground">{pending.length} pending · {approved.length} approved</p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading comments…</p>
      ) : comments.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No comments yet</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {comments.map(c => {
            const post = postMap[c.post_id];
            return (
              <Card key={c.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">{c.author_name}</span>
                        {c.author_email && <span className="text-xs text-muted-foreground">{c.author_email}</span>}
                        <Badge variant={c.status === 'approved' ? 'default' : 'secondary'}>
                          {c.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{format(parseISO(c.created_at), 'MMM dd, yyyy HH:mm')}</span>
                      </div>
                      {post && (
                        <p className="text-xs text-muted-foreground">
                          on <span className="font-medium">{post.title_en}</span>
                        </p>
                      )}
                      <p className="text-sm text-foreground">{c.content}</p>

                      {c.ai_reply && (
                        <div className="mt-2 p-3 rounded-lg bg-muted">
                          <p className="text-xs font-medium text-muted-foreground mb-1">
                            <MessageCircle className="w-3 h-3 inline mr-1" />AI reply
                          </p>
                          <p className="text-sm text-foreground">{c.ai_reply}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-1 shrink-0">
                      {c.status === 'pending' && (
                        <Button variant="ghost" size="icon" onClick={() => approveMutation.mutate(c.id)} disabled={approveMutation.isPending}>
                          <Check className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => regenerateReply.mutate(c)} disabled={regenerateReply.isPending}>
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(c.id)} disabled={deleteMutation.isPending}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CommentsManager;

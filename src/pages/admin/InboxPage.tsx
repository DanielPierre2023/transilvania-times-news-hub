import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Mail, MailOpen, Archive, AlertTriangle, Send } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const InboxPage = () => {
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const qc = useQueryClient();

  const { data: messages = [] } = useQuery({
    queryKey: ['contact_messages'],
    queryFn: async () => {
      const { data } = await supabase.from('contact_messages').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const selectedMsg = messages.find(m => m.id === selected);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await supabase.from('contact_messages').update({ status }).eq('id', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contact_messages'] }),
  });

  const sendReply = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const { data, error } = await supabase.functions.invoke('send-inbox-reply', {
        body: { messageId: selected, replyText: reply },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact_messages'] });
      setReply('');
      toast.success('Reply sent via email');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to send reply'),
  });

  const statusIcon: Record<string, React.ReactNode> = {
    unread: <Mail className="w-4 h-4 text-primary" />,
    read: <MailOpen className="w-4 h-4 text-muted-foreground" />,
    replied: <Send className="w-4 h-4 text-green-600" />,
    archived: <Archive className="w-4 h-4 text-muted-foreground" />,
    spam: <AlertTriangle className="w-4 h-4 text-destructive" />,
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-serif font-bold text-foreground">Inbox</h1>

      <div className="grid grid-cols-3 gap-0 rounded-lg border border-border overflow-hidden bg-card" style={{ minHeight: '600px' }}>
        {/* Message list */}
        <div className="col-span-1 border-r border-border overflow-y-auto" style={{ maxHeight: '700px' }}>
          {messages.map(m => (
            <div
              key={m.id}
              onClick={() => {
                setSelected(m.id);
                if (m.status === 'unread') updateStatus.mutate({ id: m.id, status: 'read' });
              }}
              className={`p-4 border-b border-border cursor-pointer transition-colors hover:bg-muted ${selected === m.id ? 'bg-muted' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                {statusIcon[m.status || 'unread']}
                <span className="font-medium text-sm text-foreground truncate">{m.name}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate">{m.subject || m.message.slice(0, 60)}</p>
              <p className="text-xs text-muted-foreground mt-1">{format(parseISO(m.created_at), 'MMM dd, HH:mm')}</p>
            </div>
          ))}
          {messages.length === 0 && <p className="p-6 text-center text-muted-foreground text-sm">No messages</p>}
        </div>

        {/* Message detail */}
        <div className="col-span-2 p-6 overflow-y-auto">
          {selectedMsg ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{selectedMsg.subject || 'No Subject'}</h2>
                <p className="text-sm text-muted-foreground">From: {selectedMsg.name} &lt;{selectedMsg.email}&gt;</p>
                <p className="text-xs text-muted-foreground">{format(parseISO(selectedMsg.created_at), 'MMMM dd, yyyy HH:mm')}</p>
              </div>

              <div className="flex gap-2">
                {['read', 'archived', 'spam'].map(s => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    onClick={() => updateStatus.mutate({ id: selectedMsg.id, status: s })}
                    className={`text-xs capitalize ${selectedMsg.status === s ? 'bg-muted' : ''}`}
                  >
                    {statusIcon[s]} {s}
                  </Button>
                ))}
              </div>

              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{selectedMsg.message}</p>

              {selectedMsg.admin_reply && (
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Your reply</p>
                  <p className="text-sm text-foreground">{selectedMsg.admin_reply}</p>
                </div>
              )}

              <div className="space-y-3">
                <Textarea placeholder="Write your reply…" value={reply} onChange={e => setReply(e.target.value)} className="min-h-[120px]" />
                <Button onClick={() => sendReply.mutate()} disabled={!reply || sendReply.isPending} className="gap-2">
                  <Send className="w-4 h-4" /> Reply
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Select a message to view</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InboxPage;

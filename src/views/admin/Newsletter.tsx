import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Send, Wand2, Eye, Save, Zap, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const AdminNewsletter = () => {
  const qc = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [targetLang, setTargetLang] = useState('all');
  const [aiTopic, setAiTopic] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const { data: campaigns = [] } = useQuery({
    queryKey: ['newsletter_campaigns'],
    queryFn: async () => {
      const { data } = await supabase.from('newsletter_campaigns').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const { data: recipientCount = 0 } = useQuery({
    queryKey: ['newsletter_recipient_count'],
    queryFn: async () => {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('email')
        .eq('newsletter_subscribed', true);
      const { data: subscribers } = await supabase
        .from('newsletter_subscribers')
        .select('email')
        .eq('is_active', true);

      const emails = new Set<string>();
      (contacts || []).forEach(c => emails.add(c.email.toLowerCase()));
      (subscribers || []).forEach(s => emails.add(s.email.toLowerCase()));
      return emails.size;
    },
  });

  const saveCampaign = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('newsletter_campaigns').insert({
        subject,
        content: contentHtml,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['newsletter_campaigns'] });
      setComposerOpen(false);
      setSubject('');
      setContentHtml('');
      toast.success('Campaign saved as draft');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save campaign'),
  });

  const sendCampaign = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('send-newsletter', {
        body: { campaignId: id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['newsletter_campaigns'] });
      toast.success(`Campaign sent to ${data?.sentCount || 0} subscribers`);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to send campaign'),
  });

  const generateDigest = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('generate-weekly-newsletter');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['newsletter_campaigns'] });
      toast.success(`Weekly digest sent to ${data?.sentCount || 0} subscribers`);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to generate digest'),
  });

  const aiCompose = async () => {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-newsletter-composer', {
        body: { topic: aiTopic, tone: 'professional', language: targetLang === 'ro' ? 'Romanian' : 'English' },
      });
      if (error) throw error;
      setContentHtml(data.content_html);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Newsletter</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
            <Users className="w-4 h-4" /> {recipientCount} recipients
            <span>•</span>
            <span>Auto-send: Sundays 10:00 UTC</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => generateDigest.mutate()}
            disabled={generateDigest.isPending}
            className="gap-2"
          >
            <Zap className="w-4 h-4" />
            {generateDigest.isPending ? 'Generating…' : 'Generate Weekly Digest'}
          </Button>

          <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" /> Manual Campaign</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Compose Campaign</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="Subject line" value={subject} onChange={e => setSubject(e.target.value)} />
                  <Select value={targetLang} onValueChange={setTargetLang}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Languages</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ro">Romanian</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-2">
                  <Input placeholder="AI topic — describe newsletter content" value={aiTopic} onChange={e => setAiTopic(e.target.value)} className="flex-1" />
                  <Button variant="outline" onClick={aiCompose} disabled={aiLoading || !aiTopic} className="gap-2">
                    <Wand2 className="w-4 h-4" /> AI Compose
                  </Button>
                </div>

                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)} className="gap-1 text-xs">
                    <Eye className="w-3 h-3" /> {showPreview ? 'Edit' : 'Preview'}
                  </Button>
                </div>

                {showPreview ? (
                  <div className="border rounded-lg p-4 min-h-[300px] prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: contentHtml }} />
                ) : (
                  <Textarea value={contentHtml} onChange={e => setContentHtml(e.target.value)} placeholder="HTML content…" className="min-h-[300px] font-mono text-sm" />
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setComposerOpen(false)}>Cancel</Button>
                  <Button onClick={() => saveCampaign.mutate()} disabled={!subject || saveCampaign.isPending} className="gap-2">
                    <Save className="w-4 h-4" /> Save Draft
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map(c => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-foreground">{c.subject}</TableCell>
                <TableCell><Badge variant={c.status === 'sent' ? 'default' : 'secondary'}>{c.status}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{c.recipient_count || 0}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{format(parseISO(c.created_at), 'MMM dd, yyyy')}</TableCell>
                <TableCell className="text-right">
                  {c.status === 'draft' && (
                    <Button variant="outline" size="sm" onClick={() => sendCampaign.mutate(c.id)} disabled={sendCampaign.isPending} className="gap-1 text-xs">
                      <Send className="w-3 h-3" /> Send
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {campaigns.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-12">No campaigns yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default AdminNewsletter;

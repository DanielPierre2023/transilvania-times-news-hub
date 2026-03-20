import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Download, Search, Users, Mail, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const ContactsPage = () => {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [langFilter, setLangFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const qc = useQueryClient();

  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts'],
    queryFn: async () => {
      const { data } = await supabase.from('contacts').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const toggleNewsletter = useMutation({
    mutationFn: async ({ id, subscribed }: { id: string; subscribed: boolean }) => {
      const { error } = await supabase.from('contacts').update({ newsletter_subscribed: subscribed } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });

  const filtered = contacts.filter(c => {
    if (sourceFilter !== 'all' && c.source !== sourceFilter) return false;
    if (langFilter !== 'all' && (c as any).language !== langFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!c.email.toLowerCase().includes(q) && !(c.name || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)));
    }
  };

  const exportCSV = () => {
    const rows = selectedIds.size > 0 ? filtered.filter(c => selectedIds.has(c.id)) : filtered;
    const csv = ['Email,Name,Source,Language,Newsletter,Date', ...rows.map(c =>
      `"${c.email}","${c.name || ''}","${c.source || ''}","${(c as any).language || 'en'}","${(c as any).newsletter_subscribed || false}","${c.created_at}"`
    )].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'contacts.csv'; a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const sourceIcon: Record<string, React.ReactNode> = {
    newsletter: <Mail className="w-3 h-3" />,
    contact_form: <FileText className="w-3 h-3" />,
    manual: <Users className="w-3 h-3" />,
  };

  const stats = {
    total: contacts.length,
    subscribed: contacts.filter(c => (c as any).newsletter_subscribed).length,
    sources: [...new Set(contacts.map(c => c.source))].length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            {stats.total} contacts · {stats.subscribed} newsletter subscribers
          </p>
        </div>
        <Button variant="outline" onClick={exportCSV} className="gap-2">
          <Download className="w-4 h-4" /> Export {selectedIds.size > 0 ? `(${selectedIds.size})` : 'All'}
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search contacts…" value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="newsletter">Newsletter</SelectItem>
            <SelectItem value="contact_form">Contact Form</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
        <Select value={langFilter} onValueChange={setLangFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Languages</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="ro">Romanian</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Newsletter</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(c => (
              <TableRow key={c.id}>
                <TableCell>
                  <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} />
                </TableCell>
                <TableCell className="font-medium">{c.email}</TableCell>
                <TableCell>{c.name || '-'}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="gap-1">
                    {sourceIcon[c.source || ''] || null}
                    {(c.source || 'manual').replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell>{(c as any).language || 'en'}</TableCell>
                <TableCell>
                  <Switch
                    checked={(c as any).newsletter_subscribed || false}
                    onCheckedChange={v => toggleNewsletter.mutate({ id: c.id, subscribed: v })}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {format(parseISO(c.created_at), 'MMM dd, yyyy')}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No contacts found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default ContactsPage;

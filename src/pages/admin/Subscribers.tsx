import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Download, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const Subscribers = () => {
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState('all');
  const qc = useQueryClient();

  const { data: subscribers = [] } = useQuery({
    queryKey: ['newsletter_subscribers'],
    queryFn: async () => {
      const { data } = await supabase.from('newsletter_subscribers').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const toggleSub = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      await supabase.from('newsletter_subscribers').update({ is_active: active }).eq('id', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['newsletter_subscribers'] }),
  });

  const filtered = subscribers.filter(s => {
    if (langFilter !== 'all' && s.language !== langFilter) return false;
    if (search && !s.email.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const exportCSV = () => {
    const csv = ['Email,Language,Active,Confirmed,Date', ...filtered.map(s =>
      `${s.email},${s.language || 'en'},${s.is_active},${s.confirmed},${s.created_at}`
    )].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'subscribers.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Subscribers</h1>
          <p className="text-sm text-muted-foreground">{subscribers.filter(s => s.is_active).length} active subscribers</p>
        </div>
        <Button variant="outline" onClick={exportCSV} className="gap-2"><Download className="w-4 h-4" /> Export CSV</Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by email…" value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={langFilter} onValueChange={setLangFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Languages</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="ro">Romanian</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Confirmed</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(s => (
              <TableRow key={s.id}>
                <TableCell className="font-medium text-foreground">{s.email}</TableCell>
                <TableCell className="text-muted-foreground">{s.language || 'en'}</TableCell>
                <TableCell><Switch checked={s.is_active} onCheckedChange={v => toggleSub.mutate({ id: s.id, active: v })} /></TableCell>
                <TableCell className="text-muted-foreground">{s.confirmed ? 'Yes' : 'No'}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{format(parseISO(s.created_at), 'MMM dd, yyyy')}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-12">No subscribers found</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default Subscribers;

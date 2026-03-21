import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Rss, RefreshCw, Wand2, Pencil, Trash2, Loader2, AlertTriangle, CheckCircle, Clock, RotateCcw, Globe } from 'lucide-react';

function decodeEntities(text: string): string {
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
}

const EDITORS = [
  { value: 'marcus_webb', label: 'Marcus Webb' },
  { value: 'elena_vasilescu', label: 'Elena Vasilescu' },
  { value: 'james_chen', label: 'James Chen' },
  { value: 'sofia_marinescu', label: 'Sofia Marinescu' },
  { value: 'daniel_novak', label: 'Daniel Novak' },
];

import { CATEGORIES, SUBCATEGORIES, categoryI18nKey, subcategoryI18nKey } from '@/lib/categories';
const CATEGORY_OPTIONS = ['auto-detect', ...CATEGORIES] as const;
const LANGUAGES = [
  { value: 'en', label: '🇬🇧 English' },
  { value: 'ro', label: '🇷🇴 Română' },
];

const RssScraper = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newCategory, setNewCategory] = useState('technology');
  const [newLang, setNewLang] = useState('en');
  const [scraping, setScraping] = useState<string | null>(null);
  const [scrapingAll, setScrapingAll] = useState(false);
  const [editorSelection, setEditorSelection] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: sources = [] } = useQuery({
    queryKey: ['rss_sources'],
    queryFn: async () => {
      const { data } = await supabase.from('rss_sources').select('*').order('created_at');
      return data || [];
    },
  });

  const { data: articles = [] } = useQuery({
    queryKey: ['scraped_articles'],
    queryFn: async () => {
      const { data } = await supabase.from('scraped_articles').select('*, rss_sources(category, source_language)').neq('status', 'published').order('created_at', { ascending: false });
      return data || [];
    },
    refetchInterval: (query) => {
      const data = query.state.data as any[] | undefined;
      return data?.some(a => a.status === 'rewriting') ? 5000 : false;
    },
  });

  const addSource = useMutation({
    mutationFn: async () => {
      const name = newName.trim() || (() => { try { return new URL(newUrl).hostname.replace('www.', ''); } catch { return 'Unknown'; } })();
      const { error } = await supabase.from('rss_sources').insert({ name, url: newUrl, category: newCategory, source_language: newLang } as any);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rss_sources'] }); setNewName(''); setNewUrl(''); toast.success('Source added'); },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleSource = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      await supabase.from('rss_sources').update({ is_active: active }).eq('id', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rss_sources'] }),
  });

  const updateSourceField = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: string }) => {
      await supabase.from('rss_sources').update({ [field]: value } as any).eq('id', id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rss_sources'] }); toast.success('Source updated'); },
  });

  const deleteArticle = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('scraped_articles').delete().eq('id', id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scraped_articles'] }); toast.success('Article deleted'); },
  });

  const deleteSource = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('rss_sources').delete().eq('id', id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rss_sources'] }); toast.success('Source removed'); },
  });

  const bulkDeleteArticles = useMutation({
    mutationFn: async (ids: string[]) => {
      await supabase.from('scraped_articles').delete().in('id', ids);
    },
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['scraped_articles'] });
      toast.success('Selected articles deleted');
    },
  });

  const scrapeSource = async (source: any) => {
    setScraping(source.id);
    try {
      const { data, error } = await supabase.functions.invoke('scrape-rss', { body: { feed_url: source.url } });
      if (error) throw error;
      let added = 0;
      for (const art of (data.articles || []).slice(0, 10)) {
        const exists = articles.find(a => a.original_url === art.url);
        if (!exists) {
          // Check DB for dedup
          const { data: existing } = await supabase.from('scraped_articles').select('id').eq('original_url', art.url).maybeSingle();
          if (!existing) {
            const articleCategory = source.category === 'auto-detect' ? null : source.category;
            await supabase.from('scraped_articles').insert({
              original_title: art.title, original_url: art.url, original_content: art.content_snippet, source_id: source.id,
              category: articleCategory,
            } as any);
            added++;
          }
        }
      }
      await supabase.from('rss_sources').update({ last_scraped_at: new Date().toISOString() }).eq('id', source.id);
      qc.invalidateQueries({ queryKey: ['scraped_articles'] });
      toast.success(`Scraped ${data.articles?.length || 0} articles, ${added} new`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setScraping(null);
    }
  };

  const scrapeAllActive = async () => {
    const activeSources = sources.filter((s: any) => s.is_active);
    if (activeSources.length === 0) { toast.error('No active sources'); return; }
    setScrapingAll(true);
    for (const source of activeSources) {
      await scrapeSource(source);
    }
    setScrapingAll(false);
    toast.success('All active sources scraped');
  };

  const rewriteArticle = async (article: any) => {
    const editor = editorSelection[article.id] || 'marcus_webb';
    try {
      const { data, error } = await supabase.functions.invoke('enqueue-rewrite-article', {
        body: { article_id: article.id, editor },
      });
      if (error) throw error;
      if (data?.ok) {
        toast.info('Rewrite job queued — Three-Desk pipeline running.');
        qc.invalidateQueries({ queryKey: ['scraped_articles'] });
      } else {
        toast.error(`Failed to enqueue: ${data?.message || 'Unknown error'}`);
      }
    } catch (e: any) {
      toast.error(`Enqueue failed: ${e.message}`);
    }
  };

  const retryRewrite = async (article: any) => {
    await supabase.from('scraped_articles').update({ status: 'scraped' } as any).eq('id', article.id);
    qc.invalidateQueries({ queryKey: ['scraped_articles'] });
    rewriteArticle(article);
  };

  const editAndPublish = (article: any) => {
    const artCategory = article.category || (article as any).rss_sources?.category || 'news';
    const artSubcategory = article.subcategory || '';
    navigate(`/admin/blog/new?from_rss=${article.id}&category=${artCategory}&subcategory=${artSubcategory}`);
  };

  const canPublish = (article: any) => {
    return (article.status === 'rewritten' || article.status === 'needs_review') &&
      article.rewritten_en && article.rewritten_en.length > 100 &&
      article.rewritten_ro && article.rewritten_ro.length > 100;
  };

  const getStatusBadge = (article: any) => {
    const status = article.status;

    if (status === 'rewriting') {
      return <Badge variant="outline" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Processing</Badge>;
    }
    if (status === 'needs_review') {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
                <AlertTriangle className="w-3 h-3" /> Needs Review
              </Badge>
            </TooltipTrigger>
            <TooltipContent><p>Content may need manual editing.</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    if (status === 'rewritten' && canPublish(article)) {
      return <Badge variant="default" className="gap-1"><CheckCircle className="w-3 h-3" /> Rewritten</Badge>;
    }
    if (status === 'published') {
      return <Badge variant="secondary">Published</Badge>;
    }
    return <Badge variant="secondary">{status}</Badge>;
  };

  const getSourceCategory = (article: any) => {
    const cat = article.category || (article as any).rss_sources?.category;
    const sub = article.subcategory;
    return (
      <div className="flex items-center gap-1">
        {cat && <Badge variant="outline" className="text-[10px] capitalize">{cat}</Badge>}
        {sub && <Badge variant="secondary" className="text-[10px] capitalize">{sub}</Badge>}
      </div>
    );
  };

  const getSourceLang = (article: any) => {
    const lang = (article as any).rss_sources?.source_language;
    if (!lang) return null;
    return <span className="text-[10px] text-muted-foreground">{lang === 'ro' ? '🇷🇴' : '🇬🇧'}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-serif font-bold text-foreground">RSS Scraper</h1>
        <Button
          variant="outline"
          onClick={scrapeAllActive}
          disabled={scrapingAll || !!scraping}
          className="gap-2"
        >
          <Globe className={`w-4 h-4 ${scrapingAll ? 'animate-spin' : ''}`} />
          {scrapingAll ? 'Scraping All…' : 'Scrape All Active'}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Rss className="w-5 h-5" /> RSS Sources</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Input placeholder="RSS Feed URL" value={newUrl} onChange={e => setNewUrl(e.target.value)} className="flex-1 min-w-[200px]" />
            <Input placeholder="Name (optional)" value={newName} onChange={e => setNewName(e.target.value)} className="w-40" />
            <Select value={newCategory} onValueChange={setNewCategory}>
              <SelectTrigger className="w-32 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto-detect" className="text-xs">🤖 Auto-Detect</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={newLang} onValueChange={setNewLang}>
              <SelectTrigger className="w-32 text-xs"><SelectValue placeholder="Language" /></SelectTrigger>
              <SelectContent>{LANGUAGES.map(l => <SelectItem key={l.value} value={l.value} className="text-xs">{l.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={() => addSource.mutate()} disabled={!newUrl} className="gap-2"><Plus className="w-4 h-4" /> Add</Button>
          </div>

          <div className="space-y-2">
            {sources.map((s: any) => (
              <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                <Switch checked={s.is_active} onCheckedChange={v => toggleSource.mutate({ id: s.id, active: v })} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{s.name}</p>
                    <Badge variant="outline" className="text-[10px] capitalize">{s.category || 'technology'}</Badge>
                    <span className="text-xs text-muted-foreground">{s.source_language === 'ro' ? '🇷🇴' : '🇬🇧'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{s.url}</p>
                </div>
                <Select value={s.category || 'technology'} onValueChange={v => updateSourceField.mutate({ id: s.id, field: 'category', value: v })}>
                  <SelectTrigger className="w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={s.source_language || 'en'} onValueChange={v => updateSourceField.mutate({ id: s.id, field: 'source_language', value: v })}>
                  <SelectTrigger className="w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{LANGUAGES.map(l => <SelectItem key={l.value} value={l.value} className="text-xs">{l.label}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => scrapeSource(s)} disabled={scraping === s.id} className="gap-1 text-xs">
                  <RefreshCw className={`w-3 h-3 ${scraping === s.id ? 'animate-spin' : ''}`} /> Scrape
                </Button>
                <Button variant="ghost" size="icon" onClick={() => deleteSource.mutate(s.id)} className="text-destructive h-8 w-8">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button variant="destructive" size="sm" onClick={() => {
            if (window.confirm(`Delete ${selected.size} selected article(s)?`)) {
              bulkDeleteArticles.mutate([...selected]);
            }
          }}>
            <Trash2 className="w-3 h-3 mr-1" /> Delete Selected
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={selected.size > 0 && selected.size === articles.length}
                  onCheckedChange={(checked) => {
                    if (checked) setSelected(new Set(articles.map(a => a.id)));
                    else setSelected(new Set());
                  }}
                />
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Editor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {articles.map(a => (
              <TableRow key={a.id}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(a.id)}
                    onCheckedChange={(checked) => {
                      setSelected(prev => {
                        const next = new Set(prev);
                        if (checked) next.add(a.id); else next.delete(a.id);
                        return next;
                      });
                    }}
                  />
                </TableCell>
                <TableCell className="font-medium text-foreground max-w-xs">
                  <div className="flex items-center gap-2">
                    {getSourceLang(a)}
                    <span className="truncate">{decodeEntities(a.original_title)}</span>
                  </div>
                </TableCell>
                <TableCell>{getSourceCategory(a)}</TableCell>
                <TableCell>
                  {a.status === 'scraped' && (
                    <Select value={editorSelection[a.id] || 'marcus_webb'} onValueChange={v => setEditorSelection(prev => ({ ...prev, [a.id]: v }))}>
                      <SelectTrigger className="w-36 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{EDITORS.map(e => <SelectItem key={e.value} value={e.value} className="text-xs">{e.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell>{getStatusBadge(a)}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {a.status === 'scraped' && (
                      <Button variant="outline" size="sm" onClick={() => rewriteArticle(a)} className="gap-1 text-xs">
                        <Wand2 className="w-3 h-3" /> AI Rewrite
                      </Button>
                    )}
                    {a.status === 'needs_review' && (
                      <Button variant="outline" size="sm" onClick={() => retryRewrite(a)} className="gap-1 text-xs">
                        <RotateCcw className="w-3 h-3" /> Retry
                      </Button>
                    )}
                    {a.status === 'rewriting' && (
                      <Badge variant="outline" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Working…</Badge>
                    )}
                    {canPublish(a) && (
                      <Button variant="default" size="sm" onClick={() => editAndPublish(a)} className="gap-1 text-xs">
                        <Pencil className="w-3 h-3" /> Edit & Publish
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                      if (window.confirm('Delete this scraped article?')) deleteArticle.mutate(a.id);
                    }}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {articles.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-12">No scraped articles yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default RssScraper;

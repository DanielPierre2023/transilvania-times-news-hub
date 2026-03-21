import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { Save, Eye, Wand2, Send, Bold, Italic, Heading, Link, Image, Code, List, ChevronRight, ChevronDown, Sparkles, Upload, AlignLeft, AlignCenter, AlignRight, Square, ShieldCheck, Loader2, RefreshCw, ImagePlus } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toPublicMediaUrl } from '@/lib/mediaUrl';

const EDITORS = [
  { value: 'daniel_dobos', label: 'Daniel Dobos — Senior Tech Editor' },
  { value: 'andrei_popescu', label: 'Andrei Popescu — Investigative' },
  { value: 'elena_vasilescu', label: 'Elena Vasilescu — Science Editor' },
  { value: 'lucian_bratu', label: 'Lucian Bratu — Features' },
  { value: 'sofia_marinescu', label: 'Sofia Marinescu — Research' },
  { value: 'mihai_ionescu', label: 'Mihai Ionescu — Tech Reviews' },
];

const EDITOR_NAMES: Record<string, string> = {
  daniel_dobos: 'Daniel Dobos', andrei_popescu: 'Andrei Popescu',
  elena_vasilescu: 'Elena Vasilescu', lucian_bratu: 'Lucian Bratu',
  sofia_marinescu: 'Sofia Marinescu', mihai_ionescu: 'Mihai Ionescu',
};

const AUTHORS = [
  'Daniel Dobos', 'Cristina Erika', 'Corina Bugner',
  'Andrei Popescu', 'Elena Vasilescu', 'Lucian Bratu',
  'Sofia Marinescu', 'Mihai Ionescu',
];

const AI_CHIPS = [
  { action: 'write_intro', label: 'Write Intro' },
  { action: 'improve', label: 'Improve' },
  { action: 'seo_optimize', label: 'SEO Optimize' },
  { action: 'translate_ro', label: 'Translate RO' },
  { action: 'suggest_titles', label: 'Suggest Titles' },
  { action: 'expand', label: 'Expand' },
  { action: 'grammar_fix', label: 'Grammar Fix' },
  { action: 'humanize', label: 'Humanize' },
  { action: 'generate_tags', label: 'Generate Tags' },
];

import { CATEGORIES, SUBCATEGORIES } from '@/lib/categories';
const WORD_COUNTS = [800, 1200, 1800, 2500, 3500];
const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

import { mdToHtml } from '@/lib/markdown';

const BlogEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const isEdit = !!id;
  const fromRssId = searchParams.get('from_rss');
  const coverInputRef = useRef<HTMLInputElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  const [lang, setLang] = useState<'en' | 'ro'>('en');
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverError, setCoverError] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [aiMessages, setAiMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [genOpen, setGenOpen] = useState(!isEdit);
  const [genPrompt, setGenPrompt] = useState('');
  const [genWordCount, setGenWordCount] = useState('1800');
  const [genEditor, setGenEditor] = useState('marcus_webb');
  const [genCategory, setGenCategory] = useState('politics');
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imgAlign, setImgAlign] = useState<string | null>(null);
  const [qualityChecking, setQualityChecking] = useState(false);
  const [qualityResult, setQualityResult] = useState<any>(null);

  const [form, setForm] = useState({
    title_en: '', title_ro: '', slug: '', excerpt_en: '', excerpt_ro: '',
    summary_en: '', summary_ro: '',
    content_en: '', content_ro: '', tags: '' as string, cover_image: '',
    status: 'draft', category: 'politics', subcategory: 'international' as string,
    author_name: 'Daniel Dobos',
    is_breaking: false,
    seo_title_en: '', seo_title_ro: '', seo_description_en: '', seo_description_ro: '',
  });

  const { data: post } = useQuery({
    queryKey: ['blog_post', id],
    queryFn: async () => {
      if (!id) return null;
      const { data } = await supabase.from('blog_posts').select('*').eq('id', id).single();
      return data;
    },
    enabled: isEdit,
  });

  const { data: rssArticle } = useQuery({
    queryKey: ['scraped_article', fromRssId],
    queryFn: async () => {
      const { data } = await supabase.from('scraped_articles').select('*').eq('id', fromRssId!).maybeSingle();
      return data;
    },
    enabled: !!fromRssId && !isEdit,
  });

  useEffect(() => {
    if (post) {
      const p = post as any;
      setForm({
        title_en: p.title_en || '', title_ro: p.title_ro || '', slug: p.slug || '',
        excerpt_en: p.excerpt_en || '', excerpt_ro: p.excerpt_ro || '',
        summary_en: p.summary_en || '', summary_ro: p.summary_ro || '',
        content_en: p.content_en || '', content_ro: p.content_ro || '',
        tags: (p.tags || []).join(', '), cover_image: p.cover_image || '',
        status: p.status || 'draft', category: p.category || 'politics',
        subcategory: p.subcategory || 'international',
        author_name: p.author_name || 'Daniel Dobos',
        is_breaking: p.is_breaking || false,
        seo_title_en: p.seo_title_en || '', seo_title_ro: p.seo_title_ro || '',
        seo_description_en: p.seo_description_en || '', seo_description_ro: p.seo_description_ro || '',
      });
    }
  }, [post]);

  useEffect(() => {
    if (rssArticle && !isEdit) {
      const r = rssArticle as any;
      const categoryFromUrl = searchParams.get('category');
      const subcategoryFromUrl = searchParams.get('subcategory');
      const rssCover = r.cover_image || '';
      setForm({
        title_en: r.title_en || r.original_title || '',
        title_ro: r.title_ro || '',
        slug: slugify(r.title_en || r.original_title || ''),
        content_en: r.rewritten_en || '', content_ro: r.rewritten_ro || '',
        excerpt_en: r.excerpt_en || '', excerpt_ro: r.excerpt_ro || '',
        summary_en: r.summary_en || '', summary_ro: r.summary_ro || '',
        seo_title_en: r.seo_title_en || '', seo_title_ro: r.seo_title_ro || '',
        seo_description_en: r.seo_description_en || '', seo_description_ro: r.seo_description_ro || '',
        tags: (r.rewrite_tags || []).join(', '),
        cover_image: rssCover || '',
        status: 'draft',
        category: r.category || categoryFromUrl || 'news',
        subcategory: r.subcategory || subcategoryFromUrl || 'international',
        author_name: 'Daniel Dobos',
      });
      setGenOpen(false);
    }
  }, [rssArticle, isEdit, searchParams]);

  const generateCoverViaEdgeFunction = async (title: string, excerpt: string): Promise<string | null> => {
    setCoverLoading(true);
    setCoverError(false);
    try {
      const { data, error } = await supabase.functions.invoke('generate-cover-image', {
        body: { title, excerpt },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.publicUrl;
    } catch (e: any) {
      console.error('Cover generation failed:', e.message);
      setCoverError(true);
      setCoverLoading(false);
      return null;
    }
  };

  // Reset cover loading/error state whenever cover URL changes
  useEffect(() => {
    if (form.cover_image) {
      setCoverLoading(true);
      setCoverError(false);
    }
  }, [form.cover_image]);

  const generateCoverImage = async () => {
    if (!form.title_en.trim()) { toast.error('Enter a title first'); return; }
    const url = await generateCoverViaEdgeFunction(form.title_en, form.excerpt_en || form.summary_en || '');
    if (url) {
      handleChange('cover_image', url);
      setCoverLoading(false);
      toast.success('Cover image generated and stored!');
    } else {
      toast.error('Image generation failed — try again or upload manually');
    }
  };

  const handleChange = (field: string, value: string) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'title_en' && !isEdit) next.slug = slugify(value);
      return next;
    });
  };

  const content = lang === 'en' ? form.content_en : form.content_ro;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  const uploadImage = async (file: File): Promise<string | null> => {
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('blog-images').upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from('blog-images').getPublicUrl(path);
      return data.publicUrl;
    } catch (e: any) {
      toast.error('Upload failed: ' + e.message);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await uploadImage(file);
    if (url) handleChange('cover_image', url);
  };

  const handleInlineImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !imgAlign) return;
    const url = await uploadImage(file);
    if (!url) return;
    const field = lang === 'en' ? 'content_en' : 'content_ro';
    let imgMd = `\n\n![image](${url})\n\n`;
    handleChange(field, content + imgMd);
    setImgAlign(null);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: any = {
        title_en: form.title_en, title_ro: form.title_ro, slug: form.slug,
        excerpt_en: form.excerpt_en, excerpt_ro: form.excerpt_ro,
        summary_en: form.summary_en || null, summary_ro: form.summary_ro || null,
        content_en: form.content_en, content_ro: form.content_ro,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        cover_image: form.cover_image || null, status: form.status,
        category: form.category, subcategory: form.subcategory || 'international',
        author_name: form.author_name,
        is_breaking: form.is_breaking,
        seo_title_en: form.seo_title_en || null, seo_title_ro: form.seo_title_ro || null,
        seo_description_en: form.seo_description_en || null, seo_description_ro: form.seo_description_ro || null,
        reading_time_min: readingTime,
        published_at: form.status === 'published' ? new Date().toISOString() : null,
      };

      if (!isEdit) {
        let finalSlug = payload.slug;
        const { data: existing } = await supabase
          .from('blog_posts').select('slug').like('slug', `${finalSlug}%`);
        if (existing?.some((p: any) => p.slug === finalSlug)) {
          let i = 2;
          while (existing.some((p: any) => p.slug === `${finalSlug}-${i}`)) i++;
          finalSlug = `${finalSlug}-${i}`;
        }
        payload.slug = finalSlug;
      }

      if (isEdit) {
        const { error } = await supabase.from('blog_posts').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('blog_posts').insert(payload);
        if (error) throw error;
        if (fromRssId) {
          await supabase.from('scraped_articles').update({ status: 'published' }).eq('id', fromRssId);
        }
      }
    },
    onSuccess: () => { toast.success('Post saved!'); qc.invalidateQueries({ queryKey: ['blog_posts'] }); if (!isEdit) navigate('/admin/blog'); },
    onError: (e: any) => toast.error(e.message),
  });

  const generateArticle = async () => {
    if (!genPrompt.trim()) { toast.error('Please describe your article idea'); return; }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-generate-article', {
        body: { prompt: genPrompt, word_count: parseInt(genWordCount), editor: genEditor, category: genCategory },
      });
      if (error) throw error;
      setForm(prev => {
        const newForm = {
          ...prev,
          title_en: data.title_en || prev.title_en, title_ro: data.title_ro || prev.title_ro,
          slug: data.slug || prev.slug, excerpt_en: data.excerpt_en || prev.excerpt_en,
          excerpt_ro: data.excerpt_ro || prev.excerpt_ro,
          summary_en: data.summary_en || prev.summary_en, summary_ro: data.summary_ro || prev.summary_ro,
          content_en: data.content_en || prev.content_en, content_ro: data.content_ro || prev.content_ro,
          tags: (data.tags || []).join(', '),
          category: genCategory, author_name: data.author_name || EDITOR_NAMES[genEditor] || prev.author_name,
          seo_title_en: data.seo_title_en || prev.seo_title_en, seo_title_ro: data.seo_title_ro || prev.seo_title_ro,
          seo_description_en: data.seo_description_en || prev.seo_description_en, seo_description_ro: data.seo_description_ro || prev.seo_description_ro,
        };
        // Auto-generate cover image via edge function after state update
        if (!newForm.cover_image && newForm.title_en) {
          setTimeout(async () => {
            const url = await generateCoverViaEdgeFunction(newForm.title_en, newForm.excerpt_en);
            if (url) {
              setForm(prev => ({ ...prev, cover_image: url }));
              setCoverLoading(false);
              toast.success('Cover image auto-generated!');
            }
          }, 100);
        }
        return newForm;
      });
      toast.success('Article generated! Review and edit before saving.');
      setGenOpen(false);
    } catch (e: any) { toast.error(e.message); } finally { setGenerating(false); }
  };

  const callAI = async (action: string, prompt?: string) => {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-blog-assistant', {
        body: { action, content, prompt: prompt || '' },
      });
      if (error) throw error;
      setAiMessages(prev => [...prev, { role: 'assistant', content: data.result }]);
    } catch (e: any) { toast.error(e.message); } finally { setAiLoading(false); }
  };

  const checkQuality = async () => {
    if (!content || content.length < 100) { toast.error('Content too short to check'); return; }
    setQualityChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-content-quality', {
        body: { content, language: lang, check_plagiarism: true },
      });
      if (error) throw error;
      setQualityResult(data);
      if (data.passed) {
        toast.success(`Quality check passed! AI score: ${data.ai_score}, Plagiarism: ${data.plagiarism_score}%`);
      } else {
        toast.warning(`Quality concerns detected. AI score: ${data.ai_score}, Plagiarism: ${data.plagiarism_score}%`);
      }
    } catch (e: any) { toast.error(e.message); } finally { setQualityChecking(false); }
  };

  const insertToolbar = (prefix: string, suffix: string) => {
    const field = lang === 'en' ? 'content_en' : 'content_ro';
    handleChange(field, content + prefix + suffix);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-serif font-bold text-foreground">{isEdit ? 'Edit Post' : 'New Post'}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowPreview(!showPreview)} className="gap-2">
            <Eye className="w-4 h-4" /> {showPreview ? 'Editor' : 'Preview'}
          </Button>
          <Button variant="outline" onClick={() => setShowAI(!showAI)} className="gap-2">
            <Wand2 className="w-4 h-4" /> AI Assistant
          </Button>
          <Button variant="outline" onClick={checkQuality} disabled={qualityChecking} className="gap-2">
            {qualityChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Check Quality
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="gap-2">
            <Save className="w-4 h-4" /> Save
          </Button>
        </div>
      </div>

      {qualityResult && (
        <div className="flex gap-4 p-3 bg-muted rounded-lg text-sm">
          <div>AI Score: <Badge variant={qualityResult.ai_score > 70 ? 'default' : 'destructive'}>{qualityResult.ai_score}/100</Badge></div>
          <div>Plagiarism: <Badge variant={qualityResult.plagiarism_score < 15 ? 'default' : 'destructive'}>{qualityResult.plagiarism_score}%</Badge></div>
        </div>
      )}

      {/* AI Article Generator */}
      <Collapsible open={genOpen} onOpenChange={setGenOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer">
              <CardTitle className="text-sm flex items-center gap-2">
                {genOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <Sparkles className="w-4 h-4" /> AI Article Generator
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-3">
              <Textarea placeholder="Describe the article you want to generate…" value={genPrompt} onChange={e => setGenPrompt(e.target.value)} className="min-h-[100px] text-sm" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Select value={genEditor} onValueChange={setGenEditor}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Editor" /></SelectTrigger>
                  <SelectContent>{EDITORS.map(e => <SelectItem key={e.value} value={e.value} className="text-xs">{e.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={genWordCount} onValueChange={setGenWordCount}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Words" /></SelectTrigger>
                  <SelectContent>{WORD_COUNTS.map(w => <SelectItem key={w} value={w.toString()} className="text-xs">{w} words</SelectItem>)}</SelectContent>
                </Select>
                <Select value={genCategory} onValueChange={setGenCategory}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>)}</SelectContent>
                </Select>
                <Button onClick={generateArticle} disabled={generating || !genPrompt.trim()} className="gap-2 text-sm">
                  <Sparkles className="w-4 h-4" /> {generating ? 'Generating…' : 'Generate'}
                </Button>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <div className="flex gap-6">
        <div className="flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input placeholder="Title (EN)" value={form.title_en} onChange={e => handleChange('title_en', e.target.value)} />
            <Input placeholder="Title (RO)" value={form.title_ro} onChange={e => handleChange('title_ro', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <Input placeholder="Slug" value={form.slug} onChange={e => handleChange('slug', e.target.value)} />
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
                <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => coverInputRef.current?.click()} disabled={uploading}>
                  <Upload className="w-3 h-3" /> Upload
                </Button>
                {!form.cover_image ? (
                  <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={generateCoverImage}>
                    <ImagePlus className="w-3 h-3" /> ✨ Generate
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={generateCoverImage}>
                    <RefreshCw className="w-3 h-3" /> Regenerate
                  </Button>
                )}
              </div>
              {form.cover_image && (
                <div className="relative w-full h-48 bg-muted rounded-md overflow-hidden border">
                  {coverLoading && !coverError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 bg-muted/80">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Generating image…</span>
                    </div>
                  )}
                  {coverError ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                      <span className="text-xs text-destructive">Failed to load — try Regenerate</span>
                    </div>
                  ) : (
                    <img
                      src={toPublicMediaUrl(form.cover_image)}
                      alt="Cover preview"
                      className="w-full h-full object-cover"
                      onLoad={() => setCoverLoading(false)}
                      onError={() => { setCoverLoading(false); setCoverError(true); }}
                    />
                  )}
                  <p className="absolute bottom-0 left-0 right-0 bg-background/80 text-[10px] text-muted-foreground px-2 py-1 truncate">
                    {form.cover_image.substring(0, 80)}…
                  </p>
                </div>
              )}
            </div>
            <Select value={form.status} onValueChange={v => handleChange('status', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
              </SelectContent>
            </Select>
            <Select value={form.category} onValueChange={v => handleChange('category', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.subcategory} onValueChange={v => handleChange('subcategory', v)}>
              <SelectTrigger><SelectValue placeholder="Subcategory" /></SelectTrigger>
              <SelectContent>{SUBCATEGORIES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.author_name} onValueChange={v => handleChange('author_name', v)}>
              <SelectTrigger className="text-xs"><SelectValue placeholder="Author" /></SelectTrigger>
              <SelectContent>{AUTHORS.map(a => <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 px-1">
            <label className="text-xs font-medium text-foreground flex items-center gap-2 cursor-pointer">
              <Switch checked={form.is_breaking} onCheckedChange={v => setForm(prev => ({ ...prev, is_breaking: v }))} />
              ⚡ Breaking News
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input placeholder="Excerpt (EN)" value={form.excerpt_en} onChange={e => handleChange('excerpt_en', e.target.value)} />
            <Input placeholder="Excerpt (RO)" value={form.excerpt_ro} onChange={e => handleChange('excerpt_ro', e.target.value)} />
          </div>
          <Input placeholder="Tags (comma-separated)" value={form.tags} onChange={e => handleChange('tags', e.target.value)} />
          <div className="grid grid-cols-2 gap-4">
            <Textarea placeholder="Summary (EN)" value={form.summary_en} onChange={e => handleChange('summary_en', e.target.value)} className="min-h-[80px] text-sm" />
            <Textarea placeholder="Summary (RO)" value={form.summary_ro} onChange={e => handleChange('summary_ro', e.target.value)} className="min-h-[80px] text-sm" />
          </div>

          <details className="group">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">SEO Fields</summary>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <Input placeholder="SEO Title (EN)" value={form.seo_title_en} onChange={e => handleChange('seo_title_en', e.target.value)} />
              <Input placeholder="SEO Title (RO)" value={form.seo_title_ro} onChange={e => handleChange('seo_title_ro', e.target.value)} />
              <Input placeholder="SEO Description (EN)" value={form.seo_description_en} onChange={e => handleChange('seo_description_en', e.target.value)} />
              <Input placeholder="SEO Description (RO)" value={form.seo_description_ro} onChange={e => handleChange('seo_description_ro', e.target.value)} />
            </div>
          </details>

          <Tabs value={lang} onValueChange={v => setLang(v as 'en' | 'ro')}>
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="en">English</TabsTrigger>
                <TabsTrigger value="ro">Română</TabsTrigger>
              </TabsList>
              <div className="flex gap-1">
                {[{ icon: Bold, p: '**', s: '**' }, { icon: Italic, p: '_', s: '_' }, { icon: Heading, p: '\n## ', s: '' }, { icon: Link, p: '[', s: '](url)' }, { icon: Code, p: '`', s: '`' }, { icon: List, p: '\n- ', s: '' }].map(({ icon: Icon, p, s }, i) => (
                  <Button key={i} variant="ghost" size="icon" onClick={() => insertToolbar(p, s)} className="w-8 h-8">
                    <Icon className="w-3.5 h-3.5" />
                  </Button>
                ))}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="w-8 h-8"><Image className="w-3.5 h-3.5" /></Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2">
                    <p className="text-xs font-medium mb-2">Image alignment</p>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { align: 'left', icon: AlignLeft, label: 'Left' },
                        { align: 'center', icon: AlignCenter, label: 'Center' },
                        { align: 'right', icon: AlignRight, label: 'Right' },
                        { align: 'block', icon: Square, label: 'Full Width' },
                      ].map(({ align, icon: Icon, label }) => (
                        <Button key={align} variant="outline" size="sm" className="gap-1 text-xs" onClick={() => { setImgAlign(align); inlineInputRef.current?.click(); }}>
                          <Icon className="w-3 h-3" /> {label}
                        </Button>
                      ))}
                    </div>
                    <input ref={inlineInputRef} type="file" accept="image/*" className="hidden" onChange={handleInlineImageUpload} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <TabsContent value="en">
              {showPreview ? (
                <div className="p-6 rounded-lg min-h-[400px] border prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: mdToHtml(form.content_en) }} />
              ) : (
                <Textarea value={form.content_en} onChange={e => handleChange('content_en', e.target.value)} className="min-h-[400px] font-mono text-sm" placeholder="Write your post in Markdown…" />
              )}
            </TabsContent>
            <TabsContent value="ro">
              {showPreview ? (
                <div className="p-6 rounded-lg min-h-[400px] border prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: mdToHtml(form.content_ro) }} />
              ) : (
                <Textarea value={form.content_ro} onChange={e => handleChange('content_ro', e.target.value)} className="min-h-[400px] font-mono text-sm" placeholder="Scrie postarea în Markdown…" />
              )}
            </TabsContent>
          </Tabs>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>{wordCount} words</span>
            <span>{readingTime} min read</span>
            <span>Author: {form.author_name}</span>
          </div>
        </div>

        {showAI && (
          <div className="w-80 space-y-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Wand2 className="w-4 h-4" /> AI Assistant</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {AI_CHIPS.map(chip => (
                    <Button key={chip.action} variant="outline" size="sm" disabled={aiLoading} onClick={() => callAI(chip.action)} className="text-xs h-7">
                      {chip.label}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input placeholder="Ask anything…" value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { callAI('free_chat', aiPrompt); setAiPrompt(''); } }} className="text-xs" />
                  <Button size="icon" disabled={aiLoading || !aiPrompt} onClick={() => { callAI('free_chat', aiPrompt); setAiPrompt(''); }}>
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {aiLoading && <p className="text-xs text-muted-foreground animate-pulse">Thinking…</p>}
                <div className="max-h-80 overflow-y-auto space-y-3">
                  {aiMessages.map((msg, i) => (
                    <div key={i} className="p-3 rounded-lg text-xs whitespace-pre-wrap bg-muted">
                      {msg.content}
                      <Button size="sm" variant="ghost" className="mt-2 text-xs text-primary h-6" onClick={() => handleChange(lang === 'en' ? 'content_en' : 'content_ro', content + '\n\n' + msg.content)}>
                        Apply <ChevronRight className="w-3 h-3 ml-1" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default BlogEditor;

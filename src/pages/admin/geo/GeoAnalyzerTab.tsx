import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Globe, Loader2 } from 'lucide-react';

const GeoAnalyzerTab = () => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const analyze = async () => {
    if (!url.trim()) { toast.error('Please enter a URL'); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('geo-optimize', {
        body: { url },
      });
      if (error) throw error;
      setResult(data);
      toast.success('Analysis complete');
    } catch (e: any) {
      toast.error(e.message || 'Edge function not deployed yet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="w-4 h-4" /> Page Citability Analyzer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="https://transilvaniatimes.com/article/..." value={url} onChange={e => setUrl(e.target.value)} />
            <Button onClick={analyze} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Analyze
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Analyze how well a page is optimized for AI citation in generative search results.</p>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardContent className="p-4">
            <pre className="text-xs whitespace-pre-wrap text-foreground">{JSON.stringify(result, null, 2)}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default GeoAnalyzerTab;

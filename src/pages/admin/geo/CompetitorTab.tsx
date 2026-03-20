import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Swords } from 'lucide-react';

const CompetitorTab = () => {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const analyze = async () => {
    if (!topic.trim()) { toast.error('Please enter a topic'); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('competitor-analysis', {
        body: { topic },
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
            <Swords className="w-4 h-4" /> Competitive Positioning
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="e.g. Cluj-Napoca tech startups" value={topic} onChange={e => setTopic(e.target.value)} />
            <Button onClick={analyze} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Analyze
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Analyze competitive positioning for a topic in generative AI search results.</p>
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

export default CompetitorTab;

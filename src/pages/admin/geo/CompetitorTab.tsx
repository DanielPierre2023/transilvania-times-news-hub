import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Swords, Target, Building2, Lightbulb, TrendingUp, CheckCircle2, Store } from 'lucide-react';

interface AnalysisResult {
  positioning?: string;
  vsEnterprise?: string[];
  vsBoutique?: string[];
  vsNiche?: string[];
  recommendedApproach?: string;
  estimatedROI?: string;
  raw?: string;
}

const ComparisonCard = ({ title, icon: Icon, items }: { title: string; icon: React.ElementType; items?: string[] }) => {
  if (!items || items.length === 0) return null;
  return (
    <Card className="flex-1">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{item}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

const CompetitorTab = () => {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const analyze = async () => {
    if (!topic.trim()) { toast.error('Please enter a topic'); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('competitor-analysis', {
        body: { topic },
      });
      if (error) throw error;
      if (typeof data === 'string') {
        try { setResult(JSON.parse(data)); } catch { setResult({ raw: data }); }
      } else {
        setResult(data);
      }
      toast.success('Analysis complete');
    } catch (e: any) {
      toast.error(e.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const isStructured = result && !result.raw && (result.positioning || result.vsEnterprise);

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

      {result && isStructured && (
        <div className="space-y-4">
          {/* Positioning */}
          {result.positioning && (
            <Card className="border-l-4 border-l-primary">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Target className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Positioning</p>
                    <p className="text-sm leading-relaxed">{result.positioning}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Competitive Comparisons */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ComparisonCard title="vs Enterprise" icon={Building2} items={result.vsEnterprise} />
            <ComparisonCard title="vs Boutique" icon={Store} items={result.vsBoutique} />
            <ComparisonCard title="vs Niche" icon={Swords} items={result.vsNiche} />
          </div>

          {/* Recommended Approach */}
          {result.recommendedApproach && (
            <Card className="bg-accent/30">
              <CardContent className="p-4 flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Recommended Approach</p>
                  <p className="text-sm leading-relaxed">{result.recommendedApproach}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Estimated ROI */}
          {result.estimatedROI && (
            <Card>
              <CardContent className="p-4 flex items-start gap-3">
                <TrendingUp className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Estimated ROI</p>
                  <p className="text-sm leading-relaxed">{result.estimatedROI}</p>
                  <Badge variant="secondary" className="mt-2">Projected Return</Badge>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Fallback for unstructured responses */}
      {result && !isStructured && (
        <Card>
          <CardContent className="p-4">
            <pre className="text-xs whitespace-pre-wrap text-foreground">{result.raw || JSON.stringify(result, null, 2)}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CompetitorTab;

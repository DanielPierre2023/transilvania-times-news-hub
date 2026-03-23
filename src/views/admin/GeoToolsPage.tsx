import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import GeoAnalyzerTab from './geo/GeoAnalyzerTab';
import CompetitorTab from './geo/CompetitorTab';

const GeoToolsPage = () => (
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-serif font-bold text-foreground">GEO Tools</h1>
      <p className="text-sm text-muted-foreground">Generative Engine Optimization & Competitive Intelligence</p>
    </div>

    <Tabs defaultValue="analyzer">
      <TabsList>
        <TabsTrigger value="analyzer">GEO Analyzer</TabsTrigger>
        <TabsTrigger value="competitor">Competitor Analysis</TabsTrigger>
      </TabsList>
      <TabsContent value="analyzer"><GeoAnalyzerTab /></TabsContent>
      <TabsContent value="competitor"><CompetitorTab /></TabsContent>
    </Tabs>
  </div>
);

export default GeoToolsPage;

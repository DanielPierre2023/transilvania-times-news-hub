import { Card, CardContent } from '@/components/ui/card';
import { Construction } from 'lucide-react';

const ComingSoon = () => (
  <Card>
    <CardContent className="p-12 text-center">
      <Construction className="h-10 w-10 text-primary mx-auto mb-4" />
      <h2 className="text-xl font-serif font-bold text-foreground mb-2">Coming Soon</h2>
      <p className="text-muted-foreground text-sm">This feature will be available in the next phase.</p>
    </CardContent>
  </Card>
);

export default ComingSoon;

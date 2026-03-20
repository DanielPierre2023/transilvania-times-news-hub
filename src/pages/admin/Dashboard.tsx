import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LayoutDashboard, FileText, Users, Mail, MessageCircle, Eye } from 'lucide-react';

const statCards = [
  { label: 'Total Visits', value: '—', icon: Eye, color: 'text-primary' },
  { label: 'Blog Posts', value: '—', icon: FileText, color: 'text-primary' },
  { label: 'Subscribers', value: '—', icon: Users, color: 'text-primary' },
  { label: 'Messages', value: '—', icon: Mail, color: 'text-primary' },
  { label: 'Comments', value: '—', icon: MessageCircle, color: 'text-primary' },
];

const Dashboard = () => {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-serif font-bold text-foreground flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          Dashboard
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Welcome to the Transilvania Times admin panel.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className={`h-4 w-4 ${color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <p className="text-sm">Dashboard stats will populate once data flows in. Use the sidebar to manage your content.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;

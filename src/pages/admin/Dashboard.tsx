import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3, FileText, Users, Inbox, Eye, TrendingUp } from 'lucide-react';

interface Stats {
  totalVisits: number;
  todayVisits: number;
  totalPosts: number;
  totalSubscribers: number;
  unreadMessages: number;
  pendingComments: number;
}

const Dashboard = () => {
  const [stats, setStats] = useState<Stats>({
    totalVisits: 0, todayVisits: 0, totalPosts: 0,
    totalSubscribers: 0, unreadMessages: 0, pendingComments: 0,
  });
  const [recentMessages, setRecentMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [visits, todayV, posts, subs, msgs, comments] = await Promise.all([
        supabase.from('site_analytics').select('id', { count: 'exact', head: true }),
        supabase.from('site_analytics').select('id', { count: 'exact', head: true })
          .gte('created_at', today.toISOString()),
        supabase.from('blog_posts').select('id', { count: 'exact', head: true }),
        supabase.from('newsletter_subscribers').select('id', { count: 'exact', head: true })
          .eq('is_active', true),
        supabase.from('contact_messages').select('id', { count: 'exact', head: true })
          .eq('status', 'unread'),
        supabase.from('blog_comments').select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
      ]);

      setStats({
        totalVisits: visits.count ?? 0,
        todayVisits: todayV.count ?? 0,
        totalPosts: posts.count ?? 0,
        totalSubscribers: subs.count ?? 0,
        unreadMessages: msgs.count ?? 0,
        pendingComments: comments.count ?? 0,
      });

      const { data: recent } = await supabase
        .from('contact_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      setRecentMessages(recent ?? []);
      setLoading(false);
    };

    fetchStats();
  }, []);

  const statCards = [
    { label: 'Total Visits', value: stats.totalVisits, icon: Eye, color: 'text-blue-600' },
    { label: 'Today', value: stats.todayVisits, icon: TrendingUp, color: 'text-green-600' },
    { label: 'Blog Posts', value: stats.totalPosts, icon: FileText, color: 'text-purple-600' },
    { label: 'Subscribers', value: stats.totalSubscribers, icon: Users, color: 'text-amber-600' },
    { label: 'Unread Messages', value: stats.unreadMessages, icon: Inbox, color: 'text-red-500' },
    { label: 'Pending Comments', value: stats.pendingComments, icon: BarChart3, color: 'text-cyan-600' },
  ];

  if (loading) {
    return <p className="p-8 text-muted-foreground">Loading dashboard…</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-serif font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Welcome back. Here's your overview.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recent Messages</CardTitle>
        </CardHeader>
        <CardContent>
          {recentMessages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            <div className="space-y-4">
              {recentMessages.map((msg) => (
                <div key={msg.id} className="flex items-start gap-3 border-b pb-3 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {msg.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{msg.name}</span>
                      <span className="text-xs text-muted-foreground">{msg.email}</span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{msg.message}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(msg.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;

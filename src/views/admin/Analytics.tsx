import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays, parseISO } from 'date-fns';
import { Activity, Monitor, Globe, Clock, MapPin } from 'lucide-react';

const COLORS = ['hsl(var(--primary))', 'hsl(38,80%,55%)', 'hsl(218,11%,41%)', 'hsl(0,84%,60%)', 'hsl(160,60%,45%)', 'hsl(280,60%,50%)'];

const Analytics = () => {
  const [days, setDays] = useState('30');

  const { data: analytics = [] } = useQuery({
    queryKey: ['site_analytics', days],
    queryFn: async () => {
      const since = subDays(new Date(), parseInt(days)).toISOString();
      const { data } = await supabase
        .from('site_analytics')
        .select('*')
        .gte('created_at', since)
        .order('created_at', { ascending: true });
      return data || [];
    },
  });

  const dailyVisits = useMemo(() => {
    const map: Record<string, number> = {};
    analytics.forEach((r: any) => {
      const day = format(parseISO(r.created_at), 'MMM dd');
      map[day] = (map[day] || 0) + 1;
    });
    return Object.entries(map).map(([date, visits]) => ({ date, visits }));
  }, [analytics]);

  const topPages = useMemo(() => {
    const map: Record<string, number> = {};
    analytics.forEach((r: any) => { map[r.page_path] = (map[r.page_path] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([page, visits]) => ({ page, visits }));
  }, [analytics]);

  const browserDist = useMemo(() => {
    const map: Record<string, number> = {};
    analytics.forEach((r: any) => { const b = r.browser || 'Unknown'; map[b] = (map[b] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [analytics]);

  const deviceDist = useMemo(() => {
    const map: Record<string, number> = {};
    analytics.forEach((r: any) => { const d = r.device_type || 'Unknown'; map[d] = (map[d] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [analytics]);

  const topReferrers = useMemo(() => {
    const map: Record<string, number> = {};
    analytics.forEach((r: any) => { if (r.referrer) { map[r.referrer] = (map[r.referrer] || 0) + 1; } });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [analytics]);

  const countryDist = useMemo(() => {
    const map: Record<string, number> = {};
    analytics.forEach((r: any) => { if (r.country) { map[r.country] = (map[r.country] || 0) + 1; } });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  }, [analytics]);

  const avgDuration = useMemo(() => {
    const durations = analytics.map((r: any) => r.session_duration).filter((d: any) => d && d > 0);
    if (durations.length === 0) return 0;
    return Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length);
  }, [analytics]);

  const formatDuration = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground">{analytics.length} visits in the last {days} days</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: 'Total Visits', value: analytics.length, icon: Activity },
          { label: 'Avg. Duration', value: formatDuration(avgDuration), icon: Clock },
          { label: 'Top Browser', value: browserDist.sort((a, b) => b.value - a.value)[0]?.name || '-', icon: Monitor },
          { label: 'Top Country', value: countryDist[0]?.name || '-', icon: MapPin },
          { label: 'Countries', value: countryDist.length, icon: Globe },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <Icon className="h-5 w-5 text-primary mb-2" />
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-bold text-foreground">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Daily Visits Chart */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Daily Visits</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={dailyVisits}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Line type="monotone" dataKey="visits" stroke="hsl(var(--primary))" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Pages + Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Top Pages</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topPages} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={12} />
                <YAxis dataKey="page" type="category" fontSize={10} width={120} />
                <Tooltip />
                <Bar dataKey="visits" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[{ title: 'Browsers', data: browserDist }, { title: 'Devices', data: deviceDist }].map(({ title, data }) => (
            <Card key={title}>
              <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width={100} height={100}>
                    <PieChart>
                      <Pie data={data} dataKey="value" cx="50%" cy="50%" outerRadius={40}>
                        {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1">
                    {data.map((d, i) => (
                      <div key={d.name} className="flex items-center gap-2 text-xs">
                        <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        {d.name}: {d.value}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Referrers */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Top Referrers</CardTitle></CardHeader>
        <CardContent>
          {topReferrers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No referrer data yet</p>
          ) : (
            <div className="space-y-2">
              {topReferrers.map(([ref, count]) => (
                <div key={ref} className="flex justify-between text-sm">
                  <span className="truncate text-muted-foreground">{ref}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Analytics;

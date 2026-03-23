import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdmin } from '@/hooks/useAdmin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Save, Settings, User } from 'lucide-react';

const SettingsPage = () => {
  const { userId } = useAdmin();
  const qc = useQueryClient();

  const { data: settings = [] } = useQuery({
    queryKey: ['site_settings'],
    queryFn: async () => {
      const { data } = await supabase.from('site_settings').select('*').order('key');
      return data || [];
    },
  });

  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const map: Record<string, string> = {};
    settings.forEach(s => { map[s.key] = JSON.stringify(s.value); });
    setSettingsMap(map);
  }, [settings]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      for (const [key, val] of Object.entries(settingsMap)) {
        try {
          const parsed = JSON.parse(val);
          await supabase.from('site_settings').upsert({ key, value: parsed }, { onConflict: 'key' });
        } catch {
          toast.error(`Invalid JSON for key "${key}"`);
          throw new Error('Invalid JSON');
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['site_settings'] }); toast.success('Settings saved'); },
  });

  const { data: profile } = useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
      return data;
    },
    enabled: !!userId,
  });

  const [profileForm, setProfileForm] = useState({ full_name: '', avatar_url: '' });

  useEffect(() => {
    if (profile) {
      setProfileForm({ full_name: profile.full_name || '', avatar_url: profile.avatar_url || '' });
    }
  }, [profile]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const { error } = await supabase.from('profiles').update(profileForm).eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile'] }); toast.success('Profile updated'); },
  });

  const [newKey, setNewKey] = useState('');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-serif font-bold text-foreground">Settings</h1>

      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Settings className="w-4 h-4" /> Site Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(settingsMap).map(([key, val]) => (
            <div key={key} className="flex gap-3 items-start">
              <code className="text-xs bg-muted px-2 py-1 rounded mt-2 shrink-0">{key}</code>
              <Textarea value={val} onChange={e => setSettingsMap(prev => ({ ...prev, [key]: e.target.value }))} className="text-sm font-mono flex-1 min-h-[60px]" />
            </div>
          ))}
          <div className="flex gap-2">
            <Input placeholder="New setting key" value={newKey} onChange={e => setNewKey(e.target.value)} className="w-48" />
            <Button variant="outline" size="sm" disabled={!newKey} onClick={() => { setSettingsMap(prev => ({ ...prev, [newKey]: '""' })); setNewKey(''); }}>Add Key</Button>
          </div>
          <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending} className="gap-2"><Save className="w-4 h-4" /> Save Settings</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><User className="w-4 h-4" /> Admin Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input placeholder="Full Name" value={profileForm.full_name} onChange={e => setProfileForm(p => ({ ...p, full_name: e.target.value }))} />
          <Input placeholder="Avatar URL" value={profileForm.avatar_url} onChange={e => setProfileForm(p => ({ ...p, avatar_url: e.target.value }))} />
          <Button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending} className="gap-2"><Save className="w-4 h-4" /> Save Profile</Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;

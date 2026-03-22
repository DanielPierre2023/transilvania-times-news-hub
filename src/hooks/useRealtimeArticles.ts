import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Article } from './useArticles';

export function useRealtimeArticles() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initial fetch
    const fetchArticles = async () => {
      const { data } = await supabase
        .from('articles')
        .select('*')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(20);

      setArticles(data || []);
      setIsLoading(false);
    };

    fetchArticles();

    // Subscribe to changes
    const subscription = supabase
      .channel('articles')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'articles',
          filter: "status=eq.published",
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setArticles(prev => [payload.new as Article, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setArticles(prev => 
              prev.map(a => a.id === payload.new.id ? payload.new as Article : a)
            );
          } else if (payload.eventType === 'DELETE') {
            setArticles(prev => prev.filter(a => a.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { articles, isLoading };
}

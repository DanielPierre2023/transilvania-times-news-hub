import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Define your article type based on your existing schema
export interface Article {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  featured_image_url?: string;
  category_id?: string;
  author_id?: string;
  is_breaking?: boolean;
  is_featured?: boolean;
  status?: 'draft' | 'published';
  published_at?: string;
  view_count?: number;
  created_at?: string;
  updated_at?: string;
  tags?: string[];
  reading_time?: number;
}

// ============================================
// QUERIES
// ============================================

/**
 * Fetch all published articles
 */
export function useArticles(limit = 20) {
  return useQuery<Article[], Error>({
    queryKey: ['articles', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching articles:', error);
        throw error;
      }
      return data || [];
    },
  });
}

/**
 * Fetch single article by slug
 */
export function useArticleBySlug(slug?: string) {
  return useQuery<Article | null, Error>({
    queryKey: ['article', slug],
    queryFn: async () => {
      if (!slug) return null;

      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('slug', slug)
        .single();

      if (error) {
        console.error('Error fetching article:', error);
        throw error;
      }
      return data;
    },
    enabled: !!slug,
  });
}

/**
 * Fetch featured articles
 */
export function useFeaturedArticles() {
  return useQuery<Article[], Error>({
    queryKey: ['articles', 'featured'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('is_featured', true)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      return data || [];
    },
  });
}

/**
 * Fetch breaking news
 */
export function useBreakingNews() {
  return useQuery<Article[], Error>({
    queryKey: ['articles', 'breaking'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('is_breaking', true)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60000, // Refetch every minute
  });
}

/**
 * Search articles by title, excerpt, or content
 */
export function useSearchArticles(query: string) {
  return useQuery<Article[], Error>({
    queryKey: ['articles', 'search', query],
    queryFn: async () => {
      if (!query || query.length < 2) return [];

      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('status', 'published')
        .or(
          `title.ilike.%${query}%,excerpt.ilike.%${query}%,content.ilike.%${query}%`
        )
        .limit(20);

      if (error) throw error;
      return data || [];
    },
    enabled: query.length > 1,
  });
}

/**
 * Fetch articles by category
 */
export function useArticlesByCategory(categoryId?: string) {
  return useQuery<Article[], Error>({
    queryKey: ['articles', 'category', categoryId],
    queryFn: async () => {
      if (!categoryId) return [];

      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('category_id', categoryId)
        .eq('status', 'published')
        .order('published_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!categoryId,
  });
}

/**
 * Fetch categories
 */
export function useCategories() {
  return useQuery<any[], Error>({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('position', { ascending: true });

      if (error) throw error;
      return data || [];
    },
  });
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Update article view count
 */
export function useIncrementViewCount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (articleId: string) => {
      const { error } = await supabase.rpc('increment_article_views', {
        article_id: articleId,
      });

      if (error) throw error;
    },
    onSuccess: (_, articleId) => {
      queryClient.invalidateQueries({ queryKey: ['article', articleId] });
    },
  });
}

/**
 * Add article to saved (requires authentication)
 */
export function useSaveArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (articleId: string) => {
      const { data: session } = await supabase.auth.getSession();

      if (!session?.session?.user?.id) {
        throw new Error('Must be logged in to save articles');
      }

      const { error } = await supabase.from('saved_articles').insert({
        user_id: session.session.user.id,
        article_id: articleId,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved_articles'] });
    },
  });
}

/**
 * Remove article from saved (requires authentication)
 */
export function useUnsaveArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (articleId: string) => {
      const { data: session } = await supabase.auth.getSession();

      if (!session?.session?.user?.id) {
        throw new Error('Must be logged in');
      }

      const { error } = await supabase
        .from('saved_articles')
        .delete()
        .eq('user_id', session.session.user.id)
        .eq('article_id', articleId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved_articles'] });
    },
  });
}

/**
 * Fetch user's saved articles (requires authentication)
 */
export function useSavedArticles() {
  return useQuery<Article[], Error>({
    queryKey: ['saved_articles'],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();

      if (!session?.session?.user?.id) {
        return [];
      }

      const { data, error } = await supabase
        .from('saved_articles')
        .select('articles(*)')
        .eq('user_id', session.session.user.id);

      if (error) throw error;
      return data?.map((item: any) => item.articles) || [];
    },
  });
}

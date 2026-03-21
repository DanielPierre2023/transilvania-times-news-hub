const SUPABASE_STORAGE_PREFIX = 'https://zimpimoierpsocnmnizm.supabase.co/storage/v1/object/public/';
const PRODUCTION_HOST = 'transilvaniatimes.com';

export function toPublicMediaUrl(url: string): string {
  if (!url) return url;
  if (!url.startsWith(SUPABASE_STORAGE_PREFIX)) return url;

  // Only rewrite on production (where Netlify proxy handles /media/*)
  if (typeof window !== 'undefined' && window.location.hostname !== PRODUCTION_HOST) {
    return url;
  }

  return '/media/' + url.slice(SUPABASE_STORAGE_PREFIX.length);
}

const SUPABASE_STORAGE_PREFIX = 'https://zimpimoierpsocnmnizm.supabase.co/storage/v1/object/public/';

export function toPublicMediaUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith(SUPABASE_STORAGE_PREFIX)) {
    return '/media/' + url.slice(SUPABASE_STORAGE_PREFIX.length);
  }
  return url;
}

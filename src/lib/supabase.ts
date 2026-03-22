import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase credentials in .env file');
}

console.log('✅ Supabase URL:', supabaseUrl);
console.log('✅ Supabase Key loaded (hidden for security)');

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Test connection
export async function testConnection() {
  try {
    const { data, error } = await supabase
      .from('articles')
      .select('count', { count: 'exact', head: true });

    if (error) {
      console.error('❌ Connection Error:', error);
      return false;
    }

    console.log('✅ Supabase Connection Successful!');
    console.log(`✅ Articles table has rows`);
    return true;
  } catch (err) {
    console.error('❌ Failed to connect:', err);
    return false;
  }
}

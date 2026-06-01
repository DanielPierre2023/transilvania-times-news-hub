import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isValidCounty } from '@/lib/counties'

export const runtime = 'nodejs'
export const revalidate = 300

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const county = searchParams.get('county') || ''
  const limit  = Math.min(10, Math.max(1, parseInt(searchParams.get('limit') || '3', 10)))

  if (!isValidCounty(county)) {
    return NextResponse.json({ error: 'invalid county' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('blog_posts')
    .select('slug, title_ro, title_en, cover_image, published_at, county, category')
    .eq('status', 'published')
    .eq('county', county)
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ articles: [], error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    { articles: data || [] },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } }
  )
}

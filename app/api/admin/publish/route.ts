import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

export async function POST(req: Request) {
  const { id, slug } = await req.json()
  if (!id || !slug) return NextResponse.json({ error: 'Missing id or slug' }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('blog_posts')
    .update({ status: 'published', published_at: new Date().toISOString() } as never)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Revalidate the specific article page and homepage
  revalidatePath(`/blog/${slug}`)
  revalidatePath('/')
  revalidatePath('/en')

  return NextResponse.json({ ok: true })
}

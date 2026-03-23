import ArticleEditor from '@/app/admin/components/ArticleEditor'
export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ArticleEditor articleId={id} />
}

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'
import { loadBlogSettingsForSession } from '@/lib/content/blog-settings-repo-sync'
import BlogLandingEditor from '@/components/content/BlogLandingEditor'
import type { SessionSchema } from '@/types/session-schema'

export default async function BlogLandingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role !== 'admin') {
    const allowed = await getAccessibleSessionIds(user)
    if (!allowed?.includes(id)) notFound()
  }

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('id, website_url, schema_data')
    .eq('id', id)
    .single()
  if (!session) notFound()

  const blog = await loadBlogSettingsForSession(id)
  const firmName = (session.schema_data as SessionSchema | null)?.business?.name

  return (
    <main className="p-8 max-w-[900px] mx-auto">
      <div className="mb-8">
        <Link
          href={`/admin/content/${id}/edit`}
          className="text-sm font-body text-text-muted hover:text-brand-cyan transition-colors"
        >
          &larr; Back to content editor
        </Link>
        <div className="mt-4">
          <h1 className="text-2xl font-heading font-bold text-brand-navy">Blog landing</h1>
          <p className="text-text-secondary font-body text-sm mt-1">
            {firmName ?? session.website_url} · where the articles / blog index lives, and what it&rsquo;s called
          </p>
        </div>
      </div>

      <BlogLandingEditor
        sessionId={id}
        initial={{ path: blog.path, label: blog.label, title: blog.title, intro: blog.intro }}
        hasRepo={!!blog.githubRepo}
      />
    </main>
  )
}

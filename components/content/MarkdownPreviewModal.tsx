'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type FaqItem = { question: string; answer: string }
type InternalLink = { url: string; anchor_text: string; reason: string }

type GeneratedPageRow = {
  id: string
  page_url: string
  page_title: string
  content_markdown: string | null
  meta_title: string | null
  meta_description: string | null
  target_keyword: string | null
  secondary_keywords: unknown
  url_slug: string | null
  canonical_url: string | null
  answer_block: string | null
  schema_markup_type: string | null
  eeat_signals: unknown
  internal_links: unknown
  faq_block: unknown
  llm_citation_note: string | null
  word_count_actual: number | null
  word_count_target: number | null
  admin_approved_content: boolean
  client_approved_content: boolean
}

type EditForm = {
  meta_title: string
  meta_description: string
  target_keyword: string
  content_markdown: string
}

export default function MarkdownPreviewModal({
  contentJobId,
  pageId,
  onClose,
  onApprovalChange,
  mode = 'admin',
}: {
  contentJobId: string
  pageId: string
  onClose: () => void
  onApprovalChange?: (approved: boolean) => void
  mode?: 'admin' | 'client'
}) {
  const [page, setPage] = useState<GeneratedPageRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'rendered' | 'raw'>('rendered')
  const [savingApproval, setSavingApproval] = useState(false)

  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditForm>({
    meta_title: '',
    meta_description: '',
    target_keyword: '',
    content_markdown: '',
  })
  const [saving, setSaving] = useState(false)

  const endpoint =
    mode === 'client'
      ? `/api/review/${contentJobId}/pages/${pageId}`
      : `/api/content-jobs/${contentJobId}/pages/${pageId}`

  const approvalField =
    mode === 'client' ? 'client_approved_content' : 'admin_approved_content'

  const approvalValue = page
    ? mode === 'client'
      ? page.client_approved_content
      : page.admin_approved_content
    : false

  useEffect(() => {
    let cancelled = false
    fetch(endpoint)
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (data.error) setError(data.error)
        else setPage(data.page)
      })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentJobId, pageId, mode])

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const toggleApproval = async (next: boolean) => {
    if (!page) return
    setSavingApproval(true)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [approvalField]: next }),
      })
      if (res.ok) {
        const data = await res.json()
        setPage(data.page)
        onApprovalChange?.(next)
      }
    } finally {
      setSavingApproval(false)
    }
  }

  const enterEditMode = () => {
    if (!page) return
    setEditForm({
      meta_title: page.meta_title ?? '',
      meta_description: page.meta_description ?? '',
      target_keyword: page.target_keyword ?? '',
      content_markdown: page.content_markdown ?? '',
    })
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
  }

  const saveEdit = async () => {
    if (!page) return
    setSaving(true)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta_title: editForm.meta_title,
          meta_description: editForm.meta_description,
          target_keyword: editForm.target_keyword,
          content_markdown: editForm.content_markdown,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setPage(data.page)
        setEditing(false)
      } else {
        const data = await res.json()
        setError(data.error ?? 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-navy/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-elevated w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <div className="min-w-0">
            <div className="text-sm font-heading font-semibold text-text-primary truncate">
              {page?.page_title ?? 'Loading...'}
            </div>
            <div className="text-xs font-mono text-text-muted truncate">{page?.page_url ?? ''}</div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Edit button — only shown when page is loaded and not already editing */}
            {page && !editing && (
              <button
                type="button"
                onClick={enterEditMode}
                className="px-3 py-1 text-xs font-heading font-semibold border border-border-default rounded-pill text-text-secondary hover:bg-surface-subtle transition-colors"
              >
                Edit
              </button>
            )}

            {/* Rendered / Raw toggle — hidden while editing */}
            {!editing && (
              <div className="inline-flex border border-border-default rounded-pill overflow-hidden text-xs font-heading font-semibold">
                <button
                  type="button"
                  onClick={() => setView('rendered')}
                  className={`px-3 py-1 ${view === 'rendered' ? 'bg-brand-navy text-text-inverse' : 'text-text-secondary hover:bg-surface-subtle'}`}
                >
                  Rendered
                </button>
                <button
                  type="button"
                  onClick={() => setView('raw')}
                  className={`px-3 py-1 ${view === 'raw' ? 'bg-brand-navy text-text-inverse' : 'text-text-secondary hover:bg-surface-subtle'}`}
                >
                  Raw
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-text-muted hover:text-text-primary transition-colors text-xl leading-none px-2"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-body rounded-lg px-4 py-2 mb-4">
              {error}
            </div>
          )}

          {!page ? (
            <div className="text-sm text-text-muted font-body">Loading page...</div>
          ) : editing ? (
            /* Edit mode body */
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                <label className="block">
                  <span className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide">
                    Meta title <span className="text-text-muted font-body normal-case">(max 120)</span>
                  </span>
                  <input
                    type="text"
                    maxLength={120}
                    value={editForm.meta_title}
                    onChange={e => setEditForm(f => ({ ...f, meta_title: e.target.value }))}
                    className="mt-1 block w-full border border-border-default rounded-lg px-3 py-2 text-sm font-body text-text-primary focus:outline-none focus:border-brand-cyan"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide">
                    Meta description <span className="text-text-muted font-body normal-case">(max 320)</span>
                  </span>
                  <input
                    type="text"
                    maxLength={320}
                    value={editForm.meta_description}
                    onChange={e => setEditForm(f => ({ ...f, meta_description: e.target.value }))}
                    className="mt-1 block w-full border border-border-default rounded-lg px-3 py-2 text-sm font-body text-text-primary focus:outline-none focus:border-brand-cyan"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide">
                    Target keyword <span className="text-text-muted font-body normal-case">(max 100)</span>
                  </span>
                  <input
                    type="text"
                    maxLength={100}
                    value={editForm.target_keyword}
                    onChange={e => setEditForm(f => ({ ...f, target_keyword: e.target.value }))}
                    className="mt-1 block w-full border border-border-default rounded-lg px-3 py-2 text-sm font-body text-text-primary focus:outline-none focus:border-brand-cyan"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide">
                    Content (Markdown) <span className="text-text-muted font-body normal-case">(max 50000)</span>
                  </span>
                  <textarea
                    maxLength={50000}
                    value={editForm.content_markdown}
                    onChange={e => setEditForm(f => ({ ...f, content_markdown: e.target.value }))}
                    className="mt-1 block w-full border border-border-default rounded-lg px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:border-brand-cyan min-h-[400px] resize-y"
                  />
                </label>
              </div>
            </div>
          ) : (
            <>
              {/* Metadata strip */}
              <div className="grid grid-cols-2 gap-3 text-xs font-body text-text-secondary mb-4">
                <Stat label="Meta title" value={page.meta_title} />
                <Stat label="Target keyword" value={page.target_keyword} />
                <Stat label="URL slug" value={page.url_slug} />
                <Stat
                  label="Word count"
                  value={
                    page.word_count_actual != null
                      ? `${page.word_count_actual}${page.word_count_target ? ` / ${page.word_count_target}` : ''}`
                      : '—'
                  }
                />
                <Stat label="Schema type" value={page.schema_markup_type} />
                <Stat label="Canonical" value={page.canonical_url} mono />
              </div>

              {page.meta_description && (
                <div className="text-xs font-body text-text-muted mb-4 italic">
                  {page.meta_description}
                </div>
              )}

              {/* Body */}
              <div className="border-t border-border-default pt-4">
                {view === 'rendered' ? (
                  <article className="font-body text-sm text-text-primary leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                      {page.content_markdown ?? '*No content generated yet.*'}
                    </ReactMarkdown>
                  </article>
                ) : (
                  <pre className="text-xs font-mono whitespace-pre-wrap bg-surface-subtle border border-border-default rounded p-3 max-h-[60vh] overflow-auto">
                    {page.content_markdown ?? ''}
                  </pre>
                )}
              </div>

              {/* SEO blocks */}
              <SeoBlocks page={page} />
            </>
          )}
        </div>

        {/* Footer */}
        {page && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border-default bg-surface-subtle">
            {editing ? (
              /* Edit mode footer: Save + Cancel */
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm font-heading font-semibold bg-brand-navy text-text-inverse rounded-pill hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm font-heading font-semibold border border-border-default rounded-pill text-text-secondary hover:bg-white transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              /* Normal footer: approval checkbox */
              <label className="flex items-center gap-2 text-sm font-body text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={approvalValue}
                  disabled={savingApproval}
                  onChange={e => toggleApproval(e.target.checked)}
                  className="accent-brand-cyan w-4 h-4"
                />
                <span className="font-heading font-semibold">
                  {approvalValue ? 'Approved' : 'Approve this page'}
                </span>
              </label>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-heading font-semibold text-text-secondary hover:text-brand-navy transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="text-text-muted">{label}</div>
      <div className={`${mono ? 'font-mono' : 'font-body'} text-text-primary truncate`} title={value ?? ''}>
        {value || '—'}
      </div>
    </div>
  )
}

function SeoBlocks({ page }: { page: GeneratedPageRow }) {
  const eeat = (page.eeat_signals as string[] | null) ?? []
  const links = (page.internal_links as InternalLink[] | null) ?? []
  const faq = (page.faq_block as FaqItem[] | null) ?? []
  const secondary = (page.secondary_keywords as string[] | null) ?? []

  return (
    <div className="mt-6 pt-4 border-t border-border-default space-y-4 text-sm font-body">
      <Section title="Answer block">
        <p className="text-text-secondary">{page.answer_block || '—'}</p>
      </Section>

      <Section title={`Secondary keywords (${secondary.length})`}>
        <p className="text-text-muted font-mono text-xs">
          {secondary.length ? secondary.join(', ') : '—'}
        </p>
      </Section>

      <Section title={`E-E-A-T signals (${eeat.length})`}>
        {eeat.length === 0 ? <p className="text-text-muted">—</p> : (
          <ul className="list-disc pl-5 text-text-secondary space-y-0.5">
            {eeat.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        )}
      </Section>

      <Section title={`Internal links (${links.length})`}>
        {links.length === 0 ? <p className="text-text-muted">—</p> : (
          <ul className="space-y-1 text-text-secondary">
            {links.map((l, i) => (
              <li key={i}>
                <span className="font-mono text-brand-cyan">{l.url}</span>
                <span className="text-text-muted"> · "{l.anchor_text}" · {l.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`FAQ (${faq.length})`}>
        {faq.length === 0 ? <p className="text-text-muted">—</p> : (
          <div className="space-y-2">
            {faq.map((f, i) => (
              <div key={i}>
                <p className="font-heading font-semibold text-text-primary text-sm">Q: {f.question}</p>
                <p className="text-text-secondary">{f.answer}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="LLM citation note">
        <p className="text-text-secondary italic">{page.llm_citation_note || '—'}</p>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide mb-1">{title}</h3>
      {children}
    </div>
  )
}

// Style mapping for ReactMarkdown — uses the project's design tokens directly
// instead of relying on the `prose` plugin (Tailwind v4, no typography plugin).
const MARKDOWN_COMPONENTS = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="font-heading font-bold text-xl text-brand-navy mt-4 mb-2" {...props} />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="font-heading font-bold text-lg text-brand-navy mt-4 mb-2" {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="font-heading font-semibold text-base text-brand-navy mt-3 mb-1.5" {...props} />
  ),
  h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4 className="font-heading font-semibold text-sm text-brand-navy mt-3 mb-1" {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="my-2.5" {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="list-disc pl-6 my-2.5 space-y-1" {...props} />
  ),
  ol: (props: React.OlHTMLAttributes<HTMLOListElement>) => (
    <ol className="list-decimal pl-6 my-2.5 space-y-1" {...props} />
  ),
  li: (props: React.LiHTMLAttributes<HTMLLIElement>) => <li {...props} />,
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-brand-cyan hover:underline" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-heading font-semibold text-text-primary" {...props} />
  ),
  em: (props: React.HTMLAttributes<HTMLElement>) => <em className="italic" {...props} />,
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code className="font-mono text-xs bg-surface-subtle px-1 py-0.5 rounded text-brand-navy" {...props} />
  ),
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="bg-surface-subtle border border-border-default rounded p-3 my-3 overflow-auto text-xs font-mono" {...props} />
  ),
  blockquote: (props: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="border-l-4 border-brand-cyan pl-4 italic my-3 text-text-secondary" {...props} />
  ),
  table: (props: React.TableHTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto my-3">
      <table className="min-w-full border-collapse border border-border-default text-sm" {...props} />
    </div>
  ),
  thead: (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-surface-subtle" {...props} />
  ),
  th: (props: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-border-default px-3 py-1.5 text-left font-heading font-semibold" {...props} />
  ),
  td: (props: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-border-default px-3 py-1.5" {...props} />
  ),
  hr: () => <hr className="my-4 border-border-default" />,
}

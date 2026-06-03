'use client'

import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { splitFile, serializeFile } from '@/lib/editor/frontmatter'
import { ASSET_ROOT, extractPageImages, localImageFilename } from '@/lib/editor/page-images'
import ImageReplaceControl from './ImageReplaceControl'

// Editable subset of frontmatter keys. Other keys are preserved on save but
// not exposed as form fields.
const PROMOTED_FIELDS = [
  'title',
  'meta_title',
  'meta_description',
  'target_keyword',
  'canonical_url',
  'hero',
  'hero_variant',
  'hero_image',
  'hero_subhead',
]

export default function PageEditor({
  sessionId,
  path,
  contents,
  onChange,
}: {
  sessionId: string
  path: string
  contents: string
  onChange: (next: string) => void
}) {
  const parsed = useMemo(() => splitFile(contents), [contents])
  const images = useMemo(() => extractPageImages(parsed), [parsed])
  const [preview, setPreview] = useState(false)

  // Rewrite bare image filenames in the preview to the admin asset route so
  // thumbnails actually render (the repo/bucket isn't public).
  const markdownImg = (props: { src?: string | Blob; alt?: string }) => {
    const rawSrc = typeof props.src === 'string' ? props.src : ''
    const filename = localImageFilename(rawSrc)
    const resolved = filename
      ? `/api/edit/${sessionId}/asset?path=${encodeURIComponent(ASSET_ROOT + filename)}`
      : rawSrc
    // eslint-disable-next-line @next/next/no-img-element -- private admin route
    return <img src={resolved} alt={props.alt ?? ''} className="rounded-card max-w-full" />
  }

  const setField = (key: string, value: string) => {
    if (!parsed.frontmatter) return
    const next = {
      ...parsed,
      frontmatter: {
        ...parsed.frontmatter,
        fields: { ...parsed.frontmatter.fields, [key]: value },
        order: parsed.frontmatter.order.includes(key)
          ? parsed.frontmatter.order
          : [...parsed.frontmatter.order, key],
      },
    }
    onChange(serializeFile(next))
  }

  const setBody = (body: string) => {
    onChange(serializeFile({ ...parsed, body }))
  }

  return (
    <div className="flex-1 overflow-y-auto bg-surface-default">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <div className="text-xs font-heading text-text-muted">Editing</div>
          <div className="font-heading font-semibold text-brand-navy text-lg">{path}</div>
        </div>

        {parsed.frontmatter && (
          <section className="bg-surface-card border border-border-default rounded-lg p-4">
            <h2 className="text-sm font-heading font-semibold text-brand-navy mb-3">
              Page metadata
            </h2>
            <div className="grid grid-cols-1 gap-3">
              {PROMOTED_FIELDS.map((key) => {
                const value = parsed.frontmatter!.fields[key] ?? ''
                return (
                  <label key={key} className="block">
                    <span className="block text-xs font-heading text-text-secondary mb-1">
                      {key}
                    </span>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => setField(key, e.target.value)}
                      className="w-full text-sm font-body px-3 py-2 rounded border border-border-default focus:border-brand-cyan focus:outline-none"
                    />
                  </label>
                )
              })}
            </div>
          </section>
        )}

        {images.length > 0 && (
          <section className="bg-surface-card border border-border-default rounded-lg p-4">
            <h2 className="text-sm font-heading font-semibold text-brand-navy mb-3">
              Images on this page
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {images.map((img) => (
                <ImageReplaceControl
                  key={img.key}
                  sessionId={sessionId}
                  assetPath={img.assetPath}
                  alt={img.alt}
                />
              ))}
            </div>
          </section>
        )}

        <section className="bg-surface-card border border-border-default rounded-lg">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border-default">
            <h2 className="text-sm font-heading font-semibold text-brand-navy">
              Page body
            </h2>
            <button
              onClick={() => setPreview((p) => !p)}
              className="text-xs font-heading text-brand-cyan hover:text-brand-navy"
            >
              {preview ? 'Edit source' : 'Preview'}
            </button>
          </div>
          {preview ? (
            <article className="prose max-w-none p-4 text-sm font-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: markdownImg }}>
                {parsed.body}
              </ReactMarkdown>
            </article>
          ) : (
            <textarea
              value={parsed.body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck
              className="w-full min-h-[480px] text-sm font-mono px-4 py-3 outline-none resize-y"
            />
          )}
        </section>
      </div>
    </div>
  )
}

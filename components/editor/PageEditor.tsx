'use client'

import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { splitFile, serializeFile } from '@/lib/editor/frontmatter'
import { ASSET_ROOT, extractPageImages, localImageFilename } from '@/lib/editor/page-images'
import { extractIconItems, extractIconBlockSummaries, setItemIcon } from '@/lib/editor/icon-items'
import { extractImageBlocks, setBlockImage, setBlockAlt } from '@/lib/editor/block-images'
import ImageReplaceControl from './ImageReplaceControl'
import HeaderImagePicker from './HeaderImagePicker'
import IconPickerControl from './IconPickerControl'

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

// Blog posts (content/posts/) carry a different frontmatter shape — the
// header image is handled by HeaderImagePicker, not a text field.
const POST_PROMOTED_FIELDS = [
  'title',
  'excerpt',
  'date',
  'author',
  'image_alt',
  'meta_title',
  'meta_description',
  'target_keyword',
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
  const iconItems = useMemo(() => extractIconItems(parsed.body), [parsed])
  const emptyIconBlocks = useMemo(
    () => extractIconBlockSummaries(parsed.body).filter((b) => b.itemCount === 0),
    [parsed]
  )
  const imageBlocks = useMemo(() => extractImageBlocks(parsed.body), [parsed])
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const isPost = path.startsWith('content/posts/')
  // Social suggestion files are plain copy — body-only editing, no metadata form.
  const isSocial = path.startsWith('content/social/')
  const promotedFields = isPost ? POST_PROMOTED_FIELDS : PROMOTED_FIELDS

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

  // Drop a key entirely (an empty `image:` line would fail the template's
  // frontmatter validation, so "remove" must delete, not blank).
  const removeField = (key: string) => {
    if (!parsed.frontmatter) return
    const fields = { ...parsed.frontmatter.fields }
    delete fields[key]
    const next = {
      ...parsed,
      frontmatter: {
        ...parsed.frontmatter,
        fields,
        order: parsed.frontmatter.order.filter((k) => k !== key),
      },
    }
    onChange(serializeFile(next))
  }

  const setBody = (body: string) => {
    onChange(serializeFile({ ...parsed, body }))
  }

  const title = parsed.frontmatter?.fields['title'] ?? ''

  return (
    <div className="flex-1 overflow-y-auto bg-surface-default">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-heading text-text-muted">{mode === 'view' ? 'Viewing' : 'Editing'}</div>
            <div className="font-heading font-semibold text-brand-navy text-lg truncate">{path}</div>
          </div>
          <div className="flex items-center rounded-pill border border-border-default overflow-hidden flex-shrink-0">
            {(['view', 'edit'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`text-xs font-heading font-semibold px-4 py-1.5 transition-colors capitalize ${
                  mode === m ? 'bg-brand-navy text-text-inverse' : 'text-text-secondary hover:bg-surface-subtle'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {mode === 'view' ? (
          <article className="prose max-w-none bg-surface-card border border-border-default rounded-lg p-6 text-sm font-body">
            {title && <h1 className="font-heading text-brand-navy">{title}</h1>}
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: markdownImg }}>
              {parsed.body}
            </ReactMarkdown>
          </article>
        ) : (
        <>
        {parsed.frontmatter && !isSocial && (
          <section className="bg-surface-card border border-border-default rounded-lg p-4">
            <h2 className="text-sm font-heading font-semibold text-brand-navy mb-3">
              {isPost ? 'Post metadata' : 'Page metadata'}
            </h2>
            {isPost && (
              <div className="mb-4">
                <HeaderImagePicker
                  sessionId={sessionId}
                  value={parsed.frontmatter.fields['image'] ?? ''}
                  onChange={(filename) =>
                    filename ? setField('image', filename) : removeField('image')
                  }
                />
              </div>
            )}
            <div className="grid grid-cols-1 gap-3">
              {promotedFields.map((key) => {
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

        {(iconItems.length > 0 || emptyIconBlocks.length > 0) && (
          <section className="bg-surface-card border border-border-default rounded-lg p-4">
            <h2 className="text-sm font-heading font-semibold text-brand-navy mb-3">
              Icons on this page
            </h2>
            <p className="text-xs font-body text-text-muted mb-3">
              Card icons for feature, industry, and service blocks. Changes update the
              page markdown — save to apply.
            </p>
            {iconItems.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {iconItems.map((item, idx) => (
                  <IconPickerControl
                    key={`${item.kind}-${idx}-${item.title}`}
                    item={item}
                    onChange={(name) => setBody(setItemIcon(parsed.body, item, name))}
                  />
                ))}
              </div>
            )}
            {emptyIconBlocks.map((blk, i) => (
              <div
                key={`${blk.blockId}-${i}`}
                className="mt-2 bg-warning/10 border border-warning/30 text-warning text-xs font-body rounded px-3 py-2"
              >
                “{blk.heading || blk.blockId}” ({blk.blockId}) can show icons, but its
                items aren&apos;t in a recognizable list format — rewrite them as
                “**Title**” paragraphs or “### Title” chunks in the page body to attach
                icons.
              </div>
            ))}
          </section>
        )}

        {!isPost && !isSocial && imageBlocks.length > 0 && (
          <section className="bg-surface-card border border-border-default rounded-lg p-4">
            <h2 className="text-sm font-heading font-semibold text-brand-navy mb-3">
              Section images
            </h2>
            <p className="text-xs font-body text-text-muted mb-3">
              These sections can show an image. Pick one from the library or upload —
              changes update the page markdown, save to apply.
            </p>
            <div className="space-y-4">
              {imageBlocks.map((blk) => (
                <div key={`${blk.commentIndex}-${blk.blockId}`}>
                  <HeaderImagePicker
                    sessionId={sessionId}
                    value={blk.image ?? ''}
                    label={
                      blk.heading
                        ? `${blk.heading} (${blk.blockId})`
                        : blk.blockId
                    }
                    onChange={(filename) =>
                      setBody(setBlockImage(parsed.body, blk, filename || null))
                    }
                  />
                  {blk.image && (
                    <label className="block mt-2">
                      <span className="block text-[11px] font-heading text-text-muted mb-0.5">
                        Alt text (what the photo shows — screen readers &amp; SEO)
                      </span>
                      <input
                        type="text"
                        value={blk.alt ?? ''}
                        placeholder={blk.heading || 'Describe the image'}
                        onChange={(e) =>
                          setBody(setBlockAlt(parsed.body, blk, e.target.value))
                        }
                        className="w-full text-xs font-body px-2.5 py-1.5 rounded border border-border-default focus:border-brand-cyan focus:outline-none"
                      />
                    </label>
                  )}
                </div>
              ))}
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
          <div className="px-4 py-2 border-b border-border-default">
            <h2 className="text-sm font-heading font-semibold text-brand-navy">
              Page body (markdown source)
            </h2>
          </div>
          <textarea
            value={parsed.body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck
            className="w-full min-h-[480px] text-sm font-mono px-4 py-3 outline-none resize-y"
          />
        </section>
        </>
        )}
      </div>
    </div>
  )
}

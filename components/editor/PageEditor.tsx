'use client'

import { useMemo, useState } from 'react'
import { splitFile, serializeFile, type Frontmatter } from '@/lib/editor/frontmatter'
import { ASSET_ROOT, extractPageImages, localImageFilename } from '@/lib/editor/page-images'
import { extractIconItems, extractIconBlockSummaries, setItemIcon } from '@/lib/editor/icon-items'
import { extractImageBlocks, setBlockImage, setBlockAlt } from '@/lib/editor/block-images'
import {
  extractTeamMembers,
  setTeamMemberPhoto,
  moveTeamMember,
  removeTeamMember,
} from '@/lib/editor/team-photos'
import { splitTrailers, parseFaqFromBody, setFaqAccordionBody } from '@/lib/editor/page-body'
import {
  getFaqBlock,
  setFaqBlock,
  getAnswerBlock,
  setAnswerBlock,
  getEeatSignals,
  setEeatSignals,
  getInternalLinks,
  setInternalLinks,
  type FaqItem,
  type InternalLink,
} from '@/lib/editor/structured-fields'
import ImageReplaceControl from './ImageReplaceControl'
import HeaderImagePicker from './HeaderImagePicker'
import IconPickerControl from './IconPickerControl'
import StructuredContentEditor from './StructuredContentEditor'
import RichBodyEditor from './RichBodyEditor'

type EditorTab = 'editor' | 'seo' | 'media'

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
  // The body carries dead `## SEO & AIO Metadata` / `## Structured Data` trailers
  // the template strips at render. Hide them from the editable body and the
  // preview; re-attach verbatim on save. Frontmatter is the live schema source.
  const { content: bodyContent, trailer } = useMemo(() => splitTrailers(parsed.body), [parsed.body])
  const contentFile = useMemo(
    () => ({ frontmatter: parsed.frontmatter, body: bodyContent }),
    [parsed.frontmatter, bodyContent]
  )
  const images = useMemo(() => extractPageImages(contentFile), [contentFile])
  const iconItems = useMemo(() => extractIconItems(bodyContent), [bodyContent])
  const emptyIconBlocks = useMemo(
    () => extractIconBlockSummaries(bodyContent).filter((b) => b.itemCount === 0),
    [bodyContent]
  )
  const imageBlocks = useMemo(() => extractImageBlocks(bodyContent), [bodyContent])
  const teamMembers = useMemo(() => extractTeamMembers(bodyContent), [bodyContent])
  // Default to the writing surface; switching files remounts via key={path}.
  const [tab, setTab] = useState<EditorTab>('editor')
  const isPost = path.startsWith('content/posts/')
  // Social suggestion files are plain copy — body-only editing, no metadata form.
  const isSocial = path.startsWith('content/social/')
  const promotedFields = isPost ? POST_PROMOTED_FIELDS : PROMOTED_FIELDS

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
    onChange(serializeFile({ ...parsed, body: body + trailer }))
  }

  // Commit a frontmatter change plus the (trailer-less) body, re-attaching the
  // hidden trailer so it's never lost.
  const commit = (frontmatter: Frontmatter, nextBody: string) => {
    onChange(serializeFile({ frontmatter, body: nextBody + trailer }))
  }

  const title = parsed.frontmatter?.fields['title'] ?? ''

  // Structured SEO content edited as fields (frontmatter is the live source).
  // FAQ falls back to the on-page accordion prose for legacy pages that have no
  // frontmatter faq_block yet, so opening + saving migrates them.
  const fm = parsed.frontmatter
  const faqBlock = fm ? getFaqBlock(fm) : []
  const displayFaq = faqBlock.length > 0 ? faqBlock : parseFaqFromBody(bodyContent)
  const faqHeading = 'Frequently Asked Questions'
  const onFaqChange = (items: FaqItem[]) => {
    if (!fm) return
    // Drop in-progress blank rows before persisting so neither frontmatter nor
    // the on-page accordion gets an empty Q&A.
    const cleaned = items.filter((it) => it.question.trim() !== '' || it.answer.trim() !== '')
    commit(setFaqBlock(fm, cleaned), setFaqAccordionBody(bodyContent, cleaned, faqHeading))
  }
  const onAnswerChange = (text: string) => {
    if (fm) commit(setAnswerBlock(fm, text), bodyContent)
  }
  const onEeatChange = (signals: string[]) => {
    if (fm) commit(setEeatSignals(fm, signals), bodyContent)
  }
  const onLinksChange = (links: InternalLink[]) => {
    if (fm) commit(setInternalLinks(fm, links), bodyContent)
  }
  const heroRaw = parsed.frontmatter?.fields['image'] ?? parsed.frontmatter?.fields['hero_image'] ?? ''
  const heroFile = heroRaw ? localImageFilename(heroRaw) : ''
  const heroSrc = heroFile
    ? `/api/edit/${sessionId}/asset?path=${encodeURIComponent(ASSET_ROOT + heroFile)}`
    : ''

  const metadataSection =
    parsed.frontmatter && !isSocial ? (
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
                <span className="block text-xs font-heading text-text-secondary mb-1">{key}</span>
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
    ) : null

  const iconsSection =
    iconItems.length > 0 || emptyIconBlocks.length > 0 ? (
      <section className="bg-surface-card border border-border-default rounded-lg p-4">
        <h2 className="text-sm font-heading font-semibold text-brand-navy mb-3">Icons on this page</h2>
        <p className="text-xs font-body text-text-muted mb-3">
          Card icons for feature, industry, and service blocks. Changes update the page markdown —
          save to apply.
        </p>
        {iconItems.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {iconItems.map((item, idx) => (
              <IconPickerControl
                key={`${item.kind}-${idx}-${item.title}`}
                item={item}
                onChange={(name) => setBody(setItemIcon(bodyContent, item, name))}
              />
            ))}
          </div>
        )}
        {emptyIconBlocks.map((blk, i) => (
          <div
            key={`${blk.blockId}-${i}`}
            className="mt-2 bg-warning/10 border border-warning/30 text-warning-strong text-xs font-body rounded px-3 py-2"
          >
            “{blk.heading || blk.blockId}” ({blk.blockId}) can show icons, but its items aren&apos;t
            in a recognizable list format — rewrite them as “**Title**” paragraphs or “### Title”
            chunks in the page body to attach icons.
          </div>
        ))}
      </section>
    ) : null

  const sectionImagesSection =
    !isPost && !isSocial && imageBlocks.length > 0 ? (
      <section className="bg-surface-card border border-border-default rounded-lg p-4">
        <h2 className="text-sm font-heading font-semibold text-brand-navy mb-3">Section images</h2>
        <p className="text-xs font-body text-text-muted mb-3">
          These sections can show an image. Pick one from the library or upload — changes update the
          page markdown, save to apply.
        </p>
        <div className="space-y-4">
          {imageBlocks.map((blk) => (
            <div key={`${blk.commentIndex}-${blk.blockId}`}>
              <HeaderImagePicker
                sessionId={sessionId}
                value={blk.image ?? ''}
                label={blk.heading ? `${blk.heading} (${blk.blockId})` : blk.blockId}
                onChange={(filename) => setBody(setBlockImage(bodyContent, blk, filename || null))}
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
                    onChange={(e) => setBody(setBlockAlt(bodyContent, blk, e.target.value))}
                    className="w-full text-xs font-body px-2.5 py-1.5 rounded border border-border-default focus:border-brand-cyan focus:outline-none"
                  />
                </label>
              )}
            </div>
          ))}
        </div>
      </section>
    ) : null

  const teamMemberKeys = new Set(teamMembers.map((m) => `${m.blockIndex}:${m.memberIndex}`))
  const teamPhotosSection =
    !isPost && !isSocial && teamMembers.length > 0 ? (
      <section className="bg-surface-card border border-border-default rounded-lg p-4">
        <h2 className="text-sm font-heading font-semibold text-brand-navy mb-3">Team roster</h2>
        <p className="text-xs font-body text-text-muted mb-3">
          Upload a real photo to replace a member&apos;s initials avatar; reorder or remove members.
          Changes update the page markdown — save to apply.
        </p>
        <div className="space-y-4">
          {teamMembers.map((m) => {
            const canUp = teamMemberKeys.has(`${m.blockIndex}:${m.memberIndex - 1}`)
            const canDown = teamMemberKeys.has(`${m.blockIndex}:${m.memberIndex + 1}`)
            return (
              <div key={m.key} className="border border-border-default rounded-md p-3">
                <HeaderImagePicker
                  sessionId={sessionId}
                  value={m.photo ?? ''}
                  label={m.name}
                  onChange={(filename) => setBody(setTeamMemberPhoto(bodyContent, m, filename || null))}
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setBody(moveTeamMember(bodyContent, m, 'up'))}
                    disabled={!canUp}
                    className="border border-border-default text-text-secondary font-heading font-semibold text-[11px] px-3 py-1 rounded-pill transition-all hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => setBody(moveTeamMember(bodyContent, m, 'down'))}
                    disabled={!canDown}
                    className="border border-border-default text-text-secondary font-heading font-semibold text-[11px] px-3 py-1 rounded-pill transition-all hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          `Remove ${m.name} from the team section? This deletes their card and bio from the page.`
                        )
                      ) {
                        setBody(removeTeamMember(bodyContent, m))
                      }
                    }}
                    className="ml-auto text-[11px] font-heading font-semibold text-error hover:opacity-80 transition-opacity"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    ) : null

  const imagesSection =
    images.length > 0 ? (
      <section className="bg-surface-card border border-border-default rounded-lg p-4">
        <h2 className="text-sm font-heading font-semibold text-brand-navy mb-3">Images on this page</h2>
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
    ) : null

  const structuredSection =
    fm && !isPost && !isSocial ? (
      <StructuredContentEditor
        sessionId={sessionId}
        path={path}
        initialFaq={displayFaq}
        onFaqChange={onFaqChange}
        initialAnswer={getAnswerBlock(fm)}
        onAnswerChange={onAnswerChange}
        initialEeat={getEeatSignals(fm)}
        onEeatChange={onEeatChange}
        initialLinks={getInternalLinks(fm)}
        onLinksChange={onLinksChange}
      />
    ) : null

  const hasMedia =
    !!iconsSection || !!sectionImagesSection || !!teamPhotosSection || !!imagesSection
  const showSeo = !!fm && !isSocial
  const showMedia = !isSocial

  const tabs: { id: EditorTab; label: string }[] = [
    { id: 'editor', label: 'Editor' },
    ...(showSeo ? [{ id: 'seo' as const, label: 'SEO' }] : []),
    ...(showMedia ? [{ id: 'media' as const, label: 'Media' }] : []),
  ]
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'editor'

  return (
    <div className="flex-1 overflow-y-auto bg-surface-default">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-heading text-text-muted">Editing</div>
            <div className="font-heading font-semibold text-brand-navy text-lg truncate">{path}</div>
          </div>
          <div
            role="tablist"
            aria-label="Editor sections"
            className="flex items-center rounded-pill border border-border-default overflow-hidden flex-shrink-0"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => setTab(t.id)}
                className={`text-xs font-heading font-semibold px-4 py-1.5 transition-colors ${
                  activeTab === t.id
                    ? 'bg-brand-navy text-text-inverse'
                    : 'text-text-secondary hover:bg-surface-subtle'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div role="tabpanel" className="space-y-6">
          {activeTab === 'editor' && (
            <RichBodyEditor
              sessionId={sessionId}
              title={title}
              heroSrc={heroSrc}
              body={bodyContent}
              onChange={setBody}
            />
          )}

          {activeTab === 'seo' && (
            <>
              {metadataSection}
              {structuredSection}
            </>
          )}

          {activeTab === 'media' &&
            (hasMedia ? (
              <>
                {iconsSection}
                {sectionImagesSection}
                {teamPhotosSection}
                {imagesSection}
              </>
            ) : (
              <section className="bg-surface-card border border-border-default rounded-lg p-6 text-sm font-body text-text-muted">
                No icons or images on this page yet. Add image blocks in the content body, or use the
                Image library in the file tree.
              </section>
            ))}
        </div>
      </div>
    </div>
  )
}

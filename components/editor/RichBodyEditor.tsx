'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { buildProseExtensions } from '@/lib/editor/prose-extensions'
import { MARKDOWN_COMPONENTS } from '@/components/content/markdown-components'
import { ASSET_ROOT, localImageFilename } from '@/lib/editor/page-images'
import { extractImageBlocks } from '@/lib/editor/block-images'
import { extractTeamMembers } from '@/lib/editor/team-photos'
import AssetThumb from './AssetThumb'
import {
  scanBodySegments,
  serializeBodySegments,
  splitProseParts,
  joinProseParts,
  type BodySegment,
} from '@/lib/editor/body-segments'

// tiptap-markdown augments editor.storage at runtime but ships no module
// augmentation, so narrow the access here rather than reach into `any`.
type MarkdownStorage = { markdown: { getMarkdown(): string } }
const getMarkdown = (editor: Editor): string =>
  (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown()

// The single-screen content editor. Renders the page body as one formatted
// surface: structural markdown (block annotations, icon/photo lines, team grids,
// FAQ, images) stays read-only and byte-identical (edited via the Media/SEO
// panels), while ordinary prose becomes click-to-edit rich text with a small
// bubble toolbar. A raw-source toggle is kept as a safety net.

// Match the live-site markdown styling (mirrors MARKDOWN_COMPONENTS) via
// Tailwind child selectors so the editable prose renders like the preview.
const PROSE_CLASS =
  'outline-none text-sm font-body text-text-primary leading-relaxed ' +
  '[&_h1]:font-heading [&_h1]:font-bold [&_h1]:text-xl [&_h1]:text-brand-navy [&_h1]:mt-4 [&_h1]:mb-2 ' +
  '[&_h2]:font-heading [&_h2]:font-bold [&_h2]:text-lg [&_h2]:text-brand-navy [&_h2]:mt-4 [&_h2]:mb-2 ' +
  '[&_h3]:font-heading [&_h3]:font-semibold [&_h3]:text-base [&_h3]:text-brand-navy [&_h3]:mt-3 [&_h3]:mb-1.5 ' +
  '[&_h4]:font-heading [&_h4]:font-semibold [&_h4]:text-sm [&_h4]:text-brand-navy [&_h4]:mt-3 [&_h4]:mb-1 ' +
  '[&_p]:my-2.5 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2.5 [&_ul]:space-y-1 ' +
  '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2.5 [&_ol]:space-y-1 ' +
  '[&_a]:text-brand-cyan [&_a]:underline [&_strong]:font-heading [&_strong]:font-semibold ' +
  '[&_strong]:text-text-primary [&_em]:italic'

const TB_BTN =
  'text-xs font-heading font-semibold px-2.5 py-1 rounded-pill transition-colors'
const tbClass = (active: boolean) =>
  `${TB_BTN} ${active ? 'bg-brand-navy text-text-inverse' : 'text-text-secondary hover:bg-surface-subtle'}`

// Drop the machine-only lines (comments, icon:, photo:) so read-only structural
// segments render like the live page rather than showing raw directives.
function structuralDisplay(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\s*<!--/.test(l) && !/^icon:/.test(l) && !/^photo:/.test(l))
    .join('\n')
    .trim()
}

function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase()
}

// A read-only image shown in the right rail beside the section it belongs to.
// Section images ride inside block annotations and team photos inside `photo:`
// lines — both stripped by structuralDisplay — so we surface them here instead.
type RailContent =
  | { kind: 'image'; image: string; alt: string }
  | { kind: 'team'; members: { name: string; photo: string | null }[] }

// The rail image (if any) an anchor structural segment introduces: an
// image-capable block with an `image:` set, or a team-grid with members.
function segmentRail(seg: BodySegment): RailContent | null {
  if (seg.kind !== 'structural') return null
  const withImage = extractImageBlocks(seg.text).find((b) => b.image)
  if (withImage && withImage.image) {
    return { kind: 'image', image: withImage.image, alt: withImage.alt ?? '' }
  }
  if (/^<!-- block: team-grid\b/m.test(seg.text)) {
    const members = extractTeamMembers(seg.text).map((m) => ({ name: m.name, photo: m.photo }))
    if (members.length > 0) return { kind: 'team', members }
  }
  return null
}

type EditorRow = { rail: RailContent | null; items: { seg: BodySegment; index: number }[] }

// Group the flat segment list into rows anchored on rail images. Each segment
// keeps its ORIGINAL index so prose editing (updateProse keys off it) is
// unchanged. Segments before the first anchor form a leading, rail-less row.
function groupRows(segments: BodySegment[]): EditorRow[] {
  const rows: EditorRow[] = []
  let current: EditorRow = { rail: null, items: [] }
  segments.forEach((seg, index) => {
    const rail = segmentRail(seg)
    if (rail) {
      if (current.items.length > 0) rows.push(current)
      current = { rail, items: [{ seg, index }] }
    } else {
      current.items.push({ seg, index })
    }
  })
  if (current.items.length > 0) rows.push(current)
  return rows
}

function LinkControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  const start = () => {
    setValue(editor.getAttributes('link').href ?? '')
    setOpen(true)
  }
  const apply = () => {
    const href = value.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (href) chain.setLink({ href }).run()
    else chain.unsetLink().run()
    setOpen(false)
  }

  if (open) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
        className="flex items-center gap-1"
      >
        <input
          autoFocus
          type="url"
          value={value}
          placeholder="https://…"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
          className="w-40 text-xs font-body px-2 py-1 rounded border border-border-default focus:border-brand-cyan focus:outline-none"
        />
        <button type="submit" className={tbClass(false)}>
          Apply
        </button>
      </form>
    )
  }
  return (
    <button type="button" onClick={start} className={tbClass(editor.isActive('link'))}>
      Link
    </button>
  )
}

function ProseSegment({
  core,
  onCoreChange,
}: {
  core: string
  onCoreChange: (core: string) => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: buildProseExtensions(),
    content: core,
    editorProps: { attributes: { class: PROSE_CLASS } },
    onUpdate: ({ editor }) => onCoreChange(getMarkdown(editor)),
  })

  return (
    <>
      <EditorContent editor={editor} />
      {editor && (
        <BubbleMenu
          editor={editor}
          className="flex items-center gap-1 bg-surface-card border border-border-default rounded-lg shadow-medium px-1.5 py-1"
        >
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={tbClass(editor.isActive('bold'))}
          >
            B
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`${tbClass(editor.isActive('italic'))} italic`}
          >
            I
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={tbClass(editor.isActive('heading', { level: 2 }))}
          >
            H2
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={tbClass(editor.isActive('heading', { level: 3 }))}
          >
            H3
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={tbClass(editor.isActive('bulletList'))}
          >
            • List
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={tbClass(editor.isActive('orderedList'))}
          >
            1. List
          </button>
          <LinkControl editor={editor} />
        </BubbleMenu>
      )}
    </>
  )
}

export default function RichBodyEditor({
  sessionId,
  title,
  heroSrc,
  body,
  onChange,
}: {
  sessionId: string
  title: string
  heroSrc: string
  body: string
  onChange: (next: string) => void
}) {
  const [mode, setMode] = useState<'wysiwyg' | 'source'>('wysiwyg')
  const [segments, setSegments] = useState<BodySegment[]>(() => scanBodySegments(body))
  // Bumped on external body changes to force the prose editors to remount with
  // fresh content (keeps in-progress typing safe — see the echo guard below).
  const [resetKey, setResetKey] = useState(0)
  const emittedRef = useRef(body)

  // Reconcile external edits (Media/SEO panels rewrite the same body string)
  // without clobbering the editor mid-type: ignore our own echoed value.
  useEffect(() => {
    if (body === emittedRef.current) return
    emittedRef.current = body
    setSegments(scanBodySegments(body))
    setResetKey((k) => k + 1)
  }, [body])

  const updateProse = (index: number, core: string) => {
    setSegments((prev) => {
      const seg = prev[index]
      if (!seg) return prev
      const text = joinProseParts(splitProseParts(seg.text), core)
      if (text === seg.text) return prev
      const nextSegments = prev.map((s, i) => (i === index ? { ...s, text } : s))
      const next = serializeBodySegments(nextSegments)
      emittedRef.current = next
      onChange(next)
      return nextSegments
    })
  }

  // Rewrite bare image filenames to the private admin asset route so structural
  // thumbnails render (the repo/bucket isn't public).
  const mdComponents = useMemo(
    () => ({
      ...MARKDOWN_COMPONENTS,
      img: (props: { src?: string | Blob; alt?: string }) => {
        const rawSrc = typeof props.src === 'string' ? props.src : ''
        const filename = localImageFilename(rawSrc)
        const resolved = filename
          ? `/api/edit/${sessionId}/asset?path=${encodeURIComponent(ASSET_ROOT + filename)}`
          : rawSrc
        // eslint-disable-next-line @next/next/no-img-element -- private admin route
        return <img src={resolved} alt={props.alt ?? ''} className="rounded-card max-w-full" />
      },
    }),
    [sessionId]
  )

  const cores = segments.map((s) =>
    s.kind === 'prose' ? splitProseParts(s.text).core : null
  )
  const hasProse = cores.some((c) => c)
  const firstProseIndex = segments.findIndex((s) => s.kind === 'prose')
  const rows = groupRows(segments)
  const hasRail = rows.some((r) => r.rail)

  const renderSegment = (seg: BodySegment, i: number) => {
    if (seg.kind === 'structural') {
      const display = structuralDisplay(seg.text)
      if (!display) return null
      return (
        <div key={`s-${i}`} className="opacity-90">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {display}
          </ReactMarkdown>
        </div>
      )
    }
    const core = cores[i] ?? ''
    const showEditor = core !== '' || (!hasProse && i === firstProseIndex)
    if (!showEditor) return null
    return (
      <ProseSegment
        key={`p-${resetKey}-${i}`}
        core={core}
        onCoreChange={(next) => updateProse(i, next)}
      />
    )
  }

  // Read-only rail preview so an editor can see the image anchored to a section.
  // Replacing/uploading stays in the Media tab — no controls here.
  const renderRail = (rail: RailContent) => {
    if (rail.kind === 'image') {
      return (
        <figure className="m-0">
          <AssetThumb
            sessionId={sessionId}
            assetPath={ASSET_ROOT + rail.image}
            alt={rail.alt}
            className="w-full rounded-card border border-border-default"
          />
          <figcaption className="mt-1 text-[11px] font-body text-text-muted break-words">
            {rail.alt || rail.image}
          </figcaption>
        </figure>
      )
    }
    return (
      <div className="flex flex-wrap gap-2">
        {rail.members.map((m, i) => (
          <div
            key={`${m.name}-${i}`}
            title={m.name}
            className="w-12 h-12 rounded-full bg-surface-subtle overflow-hidden flex items-center justify-center flex-shrink-0"
          >
            {m.photo ? (
              <AssetThumb
                sessionId={sessionId}
                assetPath={ASSET_ROOT + m.photo}
                alt={m.name}
                className="w-full h-full rounded-full"
              />
            ) : (
              <span className="text-[11px] font-heading font-semibold text-brand-navy">
                {initials(m.name)}
              </span>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <section className="bg-surface-card border border-border-default rounded-lg">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border-default">
        <h2 className="text-sm font-heading font-semibold text-brand-navy">
          {mode === 'wysiwyg' ? 'Page content' : 'Page body (markdown source)'}
        </h2>
        <button
          type="button"
          onClick={() => {
            // Re-derive segments from the current body when leaving source mode
            // so raw edits (which the echo guard treats as our own) surface in
            // the WYSIWYG view.
            if (mode === 'source') {
              setSegments(scanBodySegments(body))
              setResetKey((k) => k + 1)
            }
            setMode(mode === 'wysiwyg' ? 'source' : 'wysiwyg')
          }}
          className="border border-border-default text-text-secondary font-heading font-semibold text-[11px] px-3 py-1 rounded-pill transition-all hover:bg-surface-subtle"
        >
          {mode === 'wysiwyg' ? '</> Edit source' : 'Done editing source'}
        </button>
      </div>

      {mode === 'source' ? (
        <textarea
          value={body}
          onChange={(e) => {
            emittedRef.current = e.target.value
            onChange(e.target.value)
          }}
          spellCheck
          className="w-full min-h-[480px] text-sm font-mono px-4 py-3 outline-none resize-y"
        />
      ) : (
        <article className="p-8 text-sm font-body text-text-primary leading-relaxed">
          {heroSrc && (
            // eslint-disable-next-line @next/next/no-img-element -- private admin asset route
            <img src={heroSrc} alt={title} className="rounded-card w-full mb-6" />
          )}
          {title && <h1 className="font-heading font-bold text-2xl text-brand-navy mb-5">{title}</h1>}

          {hasRail
            ? rows.map((row, r) => (
                <div key={`row-${r}`} className="flex flex-col md:flex-row gap-3 md:gap-6">
                  <div className="flex-1 min-w-0">
                    {row.items.map(({ seg, index }) => renderSegment(seg, index))}
                  </div>
                  <div className="md:w-48 shrink-0 self-start md:sticky md:top-4">
                    {row.rail && renderRail(row.rail)}
                  </div>
                </div>
              ))
            : segments.map((seg, i) => renderSegment(seg, i))}
        </article>
      )}
    </section>
  )
}

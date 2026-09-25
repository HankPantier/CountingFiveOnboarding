'use client'

import { useEffect, useRef, useState } from 'react'
import { annotationOps, exportSize, nextPinNumber, shapeFromDrag, strokeWidthFor, toImagePoint, type AnnotTool, type Pt, type Shape } from '@/lib/design/annotate'
import { errorMessage } from './api'
import { downscaleImageIfNeeded } from './downscale-image'
import { FOCUS, PANEL, PRIMARY_BTN, SECONDARY_BTN, SECONDARY_BTN_SM } from './styles'

export type AnnotateSource = { kind: 'file'; file: File; label: string } | { kind: 'url'; url: string; label: string }

const DISPLAY_MAX_W = 880
const DISPLAY_MAX_H = 560
// A signed Storage screenshot can fail to load into the canvas (CORS, an
// expired link). The fallback is the upload path: pick the image from disk.
const LOAD_ERROR = 'That screenshot couldn’t be loaded for annotation. Save it to your computer, then choose it below to annotate it instead.'
const TOOLS: { key: AnnotTool; label: string }[] = [
  { key: 'box', label: 'Box' },
  { key: 'arrow', label: 'Arrow' },
  { key: 'pin', label: 'Pin' },
]

// Canvas colours come from the design tokens at runtime (no hex in JSX).
type Ink = { stroke: string; label: string; font: string }
function readInk(): Ink {
  const root = getComputedStyle(document.documentElement)
  return {
    stroke: root.getPropertyValue('--color-error').trim(),
    label: root.getPropertyValue('--color-text-inverse').trim(),
    font: getComputedStyle(document.body).fontFamily,
  }
}

function paint(canvas: HTMLCanvasElement, bitmap: ImageBitmap, shapes: Shape[], ink: Ink): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  ctx.lineWidth = strokeWidthFor(width, height)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (ink.stroke) {
    ctx.strokeStyle = ink.stroke
    ctx.fillStyle = ink.stroke
  }
  for (const op of annotationOps(shapes, width, height)) {
    if (op.op === 'rect') ctx.strokeRect(op.x, op.y, op.w, op.h)
    else if (op.op === 'line') {
      ctx.beginPath()
      ctx.moveTo(op.x1, op.y1)
      ctx.lineTo(op.x2, op.y2)
      ctx.stroke()
    } else if (op.op === 'poly') {
      ctx.beginPath()
      op.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      ctx.fill()
    } else if (op.op === 'circle') {
      ctx.beginPath()
      ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.save()
      if (ink.label) ctx.fillStyle = ink.label
      ctx.font = `700 ${op.size}px ${ink.font}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(op.text, op.x, op.y)
      ctx.restore()
    }
  }
}

// Modal annotation surface: draw boxes, arrows and numbered pins over a
// screenshot, then export a PNG (≤ 2400 px long edge), downscale it in the
// browser and hand it to onSave (which uploads it as a chat attachment).
export default function AnnotateCanvas({ source: initialSource, onCancel, onSave }: { source: AnnotateSource; onCancel: () => void; onSave: (file: File) => Promise<void> }) {
  // The upload fallback swaps a URL source that failed to load for a local file.
  const [source, setSource] = useState<AnnotateSource>(initialSource)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const start = useRef<Pt | null>(null)
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tool, setTool] = useState<AnnotTool>('box')
  const [shapes, setShapes] = useState<Shape[]>([])
  const [draft, setDraft] = useState<Shape | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let blob: Blob
        if (source.kind === 'file') blob = source.file
        else {
          const res = await fetch(source.url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          blob = await res.blob()
        }
        const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
        if (cancelled) bmp.close()
        else setBitmap(bmp)
      } catch {
        if (!cancelled) setLoadError(LOAD_ERROR)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source])

  // Release the decoded image when it's replaced or the dialog closes.
  useEffect(() => () => bitmap?.close(), [bitmap])

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const scale = bitmap ? Math.min(1, DISPLAY_MAX_W / bitmap.width, DISPLAY_MAX_H / bitmap.height) : 1
  const displayW = bitmap ? Math.round(bitmap.width * scale) : 0
  const displayH = bitmap ? Math.round(bitmap.height * scale) : 0

  useEffect(() => {
    if (bitmap && canvasRef.current) paint(canvasRef.current, bitmap, draft ? [...shapes, draft] : shapes, readInk())
  }, [bitmap, shapes, draft, displayW, displayH])

  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>) => toImagePoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = pointAt(e)
    if (tool === 'pin') {
      setShapes((s) => [...s, { kind: 'pin', at: pt, n: nextPinNumber(s) }])
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = pt
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (start.current && tool !== 'pin') setDraft(shapeFromDrag(tool, start.current, pointAt(e)))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!start.current || tool === 'pin') return
    const shape = shapeFromDrag(tool, start.current, pointAt(e))
    start.current = null
    setDraft(null)
    if (shape) setShapes((s) => [...s, shape])
  }

  const save = async () => {
    if (!bitmap) return
    setSaving(true)
    setSaveError(null)
    try {
      const size = exportSize(bitmap.width, bitmap.height)
      const out = document.createElement('canvas')
      out.width = size.width
      out.height = size.height
      paint(out, bitmap, shapes, readInk())
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('The annotated image could not be created.')
      await onSave(await downscaleImageIfNeeded(new File([blob], 'annotated.png', { type: 'image/png' })))
    } catch (err) {
      setSaveError(errorMessage(err, 'Couldn’t attach the image.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/60 p-6">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="annotate-heading" tabIndex={-1} className={`${PANEL} max-h-full max-w-[960px] overflow-auto ${FOCUS}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="annotate-heading" className="font-heading text-sm font-semibold text-text-primary">Annotate</h2>
            <p className="truncate font-body text-xs text-text-muted">{source.label} — draw boxes and arrows, or drop numbered pins to refer to (“pin 2”).</p>
          </div>
          <div role="group" aria-label="Annotation tool" className="flex items-center gap-1">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tool === t.key}
                onClick={() => setTool(t.key)}
                className={tool === t.key ? `rounded-pill bg-brand-navy px-3 py-1 font-heading text-[11px] font-semibold text-text-inverse ${FOCUS}` : SECONDARY_BTN_SM}
              >
                {t.label}
              </button>
            ))}
            <button type="button" onClick={() => setShapes((s) => s.slice(0, -1))} disabled={shapes.length === 0} className={SECONDARY_BTN_SM}>
              Undo
            </button>
            <button type="button" onClick={() => setShapes([])} disabled={shapes.length === 0} className={SECONDARY_BTN_SM}>
              Clear
            </button>
          </div>
        </div>

        {loadError ? (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-error/20 bg-error/10 px-3 py-2 font-body text-xs text-error">
            <p>{loadError}</p>
            <button type="button" onClick={() => fileRef.current?.click()} className={SECONDARY_BTN_SM}>
              Choose an image…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Choose an image to annotate"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                setLoadError(null)
                setShapes([])
                setSource({ kind: 'file', file: f, label: f.name })
              }}
            />
          </div>
        ) : bitmap ? (
          <canvas
            ref={canvasRef}
            width={displayW}
            height={displayH}
            style={{ width: displayW, height: displayH }}
            className="cursor-crosshair touch-none self-center rounded-lg border border-border-default"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            aria-label="Screenshot to annotate"
          />
        ) : (
          <p className="font-body text-xs text-text-muted">Loading the image…</p>
        )}

        {saveError && <p role="alert" className="font-body text-xs text-error">{saveError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={SECONDARY_BTN}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={!bitmap || saving} className={PRIMARY_BTN}>
            {saving ? 'Attaching…' : 'Attach to message'}
          </button>
        </div>
      </div>
    </div>
  )
}

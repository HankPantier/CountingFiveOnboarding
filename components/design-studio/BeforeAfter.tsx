'use client'

import type { DesignConceptDto, RunViewport, ScreenshotDto } from '@/lib/design/run-types'
import { beforeAfterShots } from '@/lib/design/critique-ui'
import { useSyncedScroll } from './useSyncedScroll'

// The concept as first designed vs after its critique-driven revisions, side
// by side per viewport; scrolling one pane scrolls its partner.
export default function BeforeAfter({ concept }: { concept: DesignConceptDto }) {
  const pair = beforeAfterShots(concept)
  if (!pair) return null
  return (
    <section aria-label={`${concept.name}: before and after critique`} className="flex flex-col gap-3">
      <h3 className="font-heading text-xs font-semibold text-text-primary">
        {concept.name} — first design vs after {concept.iterations} revision{concept.iterations === 1 ? '' : 's'}
      </h3>
      {(['desktop', 'mobile'] as const).map((viewport) => (
        <PairRow key={viewport} viewport={viewport} name={concept.name} before={pair.before} after={pair.after} />
      ))}
    </section>
  )
}

function PairRow({ viewport, name, before, after }: { viewport: RunViewport; name: string; before: ScreenshotDto[]; after: ScreenshotDto[] }) {
  const { register, onScroll } = useSyncedScroll()
  const label = viewport === 'desktop' ? 'Desktop (1440)' : 'Mobile (390)'
  const panes = [
    { key: 'before', title: 'First design', shot: before.find((s) => s.viewport === viewport) },
    { key: 'after', title: 'After critique', shot: after.find((s) => s.viewport === viewport) },
  ]
  if (panes.every((p) => !p.shot)) return null
  return (
    <div>
      <h4 className="mb-1.5 font-heading text-[11px] font-semibold text-text-secondary">{label}</h4>
      <div className={`grid gap-2 ${viewport === 'desktop' ? 'lg:grid-cols-2' : 'grid-cols-2'}`}>
        {panes.map((p, i) => (
          <figure key={p.key} className="flex min-w-0 flex-col gap-1">
            <figcaption className="font-body text-[11px] text-text-muted">{p.title}</figcaption>
            <div
              ref={register(i)}
              onScroll={() => onScroll(i)}
              tabIndex={0}
              role="region"
              aria-label={`${name} — ${p.title} — ${label}`}
              className="max-h-[420px] overflow-y-auto rounded-lg border border-border-default bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
            >
              {p.shot ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the private bucket
                <img src={p.shot.url} alt={`${name} — ${p.title}, ${viewport}`} className="block w-full" />
              ) : (
                <p className="p-3 font-body text-[11px] italic text-text-muted">No render</p>
              )}
            </div>
          </figure>
        ))}
      </div>
    </div>
  )
}

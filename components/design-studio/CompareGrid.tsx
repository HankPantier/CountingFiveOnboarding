'use client'

import type { DesignRunDto, RunViewport, ScreenshotDto } from '@/lib/design/run-types'
import { useSyncedScroll } from './useSyncedScroll'

type Column = { key: string; name: string; shots: ScreenshotDto[] }

// Side-by-side stored screenshots (current design + each concept), one row per
// viewport. Scrolling any pane scrolls the others in its row to the same
// relative position, so the same section lines up across concepts.
export default function CompareGrid({ run }: { run: DesignRunDto }) {
  const columns: Column[] = [
    { key: 'current', name: 'Current', shots: run.currentScreenshots },
    ...run.concepts.filter((c) => c.screenshots.length > 0).map((c) => ({ key: c.id, name: c.name, shots: c.screenshots })),
  ]
  if (columns.every((c) => c.shots.length === 0)) return null
  return (
    <div className="flex flex-col gap-4">
      {(['desktop', 'mobile'] as const).map((viewport) => (
        <SyncedRow key={viewport} viewport={viewport} columns={columns} />
      ))}
    </div>
  )
}

function SyncedRow({ viewport, columns }: { viewport: RunViewport; columns: Column[] }) {
  const { register, onScroll } = useSyncedScroll()

  const label = viewport === 'desktop' ? 'Desktop (1440)' : 'Mobile (390)'
  return (
    <div>
      <h3 className="mb-1.5 font-heading text-xs font-semibold text-text-primary">{label}</h3>
      <div className={`grid gap-2 ${viewport === 'desktop' ? 'lg:grid-cols-2 xl:grid-cols-4' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {columns.map((col, i) => {
          const shot = col.shots.find((s) => s.viewport === viewport)
          return (
            <figure key={col.key} className="flex min-w-0 flex-col gap-1">
              <figcaption className="truncate font-body text-[11px] text-text-muted">{col.name}</figcaption>
              <div
                ref={register(i)}
                onScroll={() => onScroll(i)}
                // Keyboard-scrollable region (a11y): focusable + named.
                tabIndex={0}
                role="region"
                aria-label={`${col.name} — ${label}`}
                className="max-h-[420px] overflow-y-auto rounded-lg border border-border-default bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
              >
                {shot ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the private bucket
                  <img src={shot.url} alt={`${col.name} — ${viewport} preview`} className="block w-full" />
                ) : (
                  <p className="p-3 font-body text-[11px] italic text-text-muted">No render</p>
                )}
              </div>
            </figure>
          )
        })}
      </div>
    </div>
  )
}

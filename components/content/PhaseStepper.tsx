import PhaseCard from './PhaseCard'
import PalettePhase from './PalettePhase'
import SitemapPhase from './SitemapPhase'
import ResearchPhase from './ResearchPhase'
import OutlinePhase from './OutlinePhase'
import GenerationPhase from './GenerationPhase'
import DeliverablesPhase from './DeliverablesPhase'
import type { PhaseStatus } from './PhaseStatusBadge'
import type { PaletteData } from '@/types/palette'

export function getPhaseStatus(jobPhase: number, thisPhase: number): PhaseStatus {
  if (thisPhase < jobPhase) return 'complete'
  if (thisPhase === jobPhase) return 'active'
  if (thisPhase === jobPhase + 1) return 'active'
  return 'locked'
}

function PaletteCompleteSummary({ palette }: { palette: PaletteData }) {
  return (
    <div className="flex items-center gap-2">
      {Object.values(palette).map((swatch, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded border border-border-default" style={{ backgroundColor: swatch.hex }} />
          <span className="text-xs font-mono text-text-muted">{swatch.hex}</span>
        </div>
      ))}
    </div>
  )
}

export default function PhaseStepper({
  currentPhase,
  sessionId,
  contentJobId,
  existingPalette,
  confirmedPageCount,
}: {
  currentPhase: number
  sessionId: string
  contentJobId: string
  existingPalette: PaletteData | null
  confirmedPageCount: number
}) {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5, 6].map(phase => {
        const status = getPhaseStatus(currentPhase, phase)
        const isComplete = status === 'complete'

        let content: React.ReactNode = null

        if (phase === 1) {
          content = isComplete && existingPalette ? (
            <PaletteCompleteSummary palette={existingPalette} />
          ) : (
            <PalettePhase
              sessionId={sessionId}
              contentJobId={contentJobId}
              existingPalette={existingPalette}
            />
          )
        } else if (phase === 2) {
          content = isComplete ? (
            <p className="text-sm text-text-muted font-body">Sitemap confirmed.</p>
          ) : (
            <SitemapPhase contentJobId={contentJobId} />
          )
        } else if (phase === 3) {
          content = isComplete ? (
            <p className="text-sm text-text-muted font-body">Research complete.</p>
          ) : (
            <ResearchPhase contentJobId={contentJobId} />
          )
        } else if (phase === 4) {
          content = isComplete ? (
            <p className="text-sm text-text-muted font-body">All outlines approved.</p>
          ) : (
            <OutlinePhase contentJobId={contentJobId} />
          )
        } else if (phase === 5) {
          content = isComplete ? (
            <p className="text-sm text-text-muted font-body">Content generation complete.</p>
          ) : (
            <GenerationPhase contentJobId={contentJobId} />
          )
        } else if (phase === 6) {
          content = (
            <DeliverablesPhase contentJobId={contentJobId} pageCount={confirmedPageCount} />
          )
        }

        return (
          <PhaseCard key={phase} phase={phase} status={status}>
            {content}
          </PhaseCard>
        )
      })}
    </div>
  )
}

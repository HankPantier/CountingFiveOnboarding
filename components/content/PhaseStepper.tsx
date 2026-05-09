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
          content = (
            <PalettePhase
              sessionId={sessionId}
              contentJobId={contentJobId}
              existingPalette={existingPalette}
              isLocked={isComplete}
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

// Pure. "Are these two concepts really different?" — CIEDE2000 ΔE on the
// primary + action colours, plus a count of differing categorical levers.
// Near-duplicate = palettes within ΔE 12 AND fewer than 2 lever differences.
// P4 feeds `distinctnessReport` to the critic (spec: distinctness.ts, ΔE via chroma-js).
import chroma from 'chroma-js'
import type { DesignBundle } from './bundle'

export const NEAR_DUPLICATE_DELTA_E = 12
export const MIN_CATEGORICAL_DIFFERENCES = 2

export function paletteDistance(a: DesignBundle['palette'], b: DesignBundle['palette']): number {
  return (chroma.deltaE(a.primary, b.primary) + chroma.deltaE(a.action, b.action)) / 2
}

export function categoricalDifferences(a: DesignBundle, b: DesignBundle): number {
  const pairs: [unknown, unknown][] = [
    [a.typography.headingFont, b.typography.headingFont],
    [a.typography.bodyFont, b.typography.bodyFont],
    [a.typography.accentFont, b.typography.accentFont],
    [a.tokens.roundness, b.tokens.roundness],
    [a.tokens.density, b.tokens.density],
    [a.tokens.visualFeel, b.tokens.visualFeel],
    [a.treatments.headlineStyle, b.treatments.headlineStyle],
    [a.treatments.eyebrowStyle, b.treatments.eyebrowStyle],
    [a.treatments.darkSections, b.treatments.darkSections],
  ]
  return pairs.filter(([x, y]) => x !== y).length
}

export function isNearDuplicate(a: DesignBundle, b: DesignBundle): boolean {
  return paletteDistance(a.palette, b.palette) < NEAR_DUPLICATE_DELTA_E && categoricalDifferences(a, b) < MIN_CATEGORICAL_DIFFERENCES
}

// For each bundle, the earliest kept bundle it duplicates. The later one of the
// pair is the one to repair.
export function findNearDuplicates(bundles: DesignBundle[]): { keep: number; drop: number }[] {
  const out: { keep: number; drop: number }[] = []
  const dropped = new Set<number>()
  for (let j = 1; j < bundles.length; j++) {
    for (let i = 0; i < j; i++) {
      if (dropped.has(i)) continue
      if (isNearDuplicate(bundles[i], bundles[j])) {
        out.push({ keep: i, drop: j })
        dropped.add(j)
        break
      }
    }
  }
  return out
}

export type DistinctnessRow = { label: string; deltaE: number; leverDifferences: number }

// Objective distance numbers the critic reads alongside the renders when it
// scores distinctiveness (vs the current site and each other concept).
export function distinctnessReport(target: DesignBundle, others: { label: string; bundle: DesignBundle }[]): DistinctnessRow[] {
  return others.map((o) => ({
    label: o.label,
    deltaE: Math.round(paletteDistance(target.palette, o.bundle.palette) * 10) / 10,
    leverDifferences: categoricalDifferences(target, o.bundle),
  }))
}

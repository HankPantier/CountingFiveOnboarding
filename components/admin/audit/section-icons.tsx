import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  FileText,
  Gauge,
  Globe,
  Layers,
  LayoutDashboard,
  Library,
  ListChecks,
  MapPin,
  Search,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react'

// One representative icon per report section, keyed by the stable section keys
// used across the report: `deriveDashboard()` bucket keys plus the fixed
// accordion keys (dashboard, recommendations, change, page_inventory, …). The
// HTML export mirrors these with inlined SVG paths in lib/audit/html-report.ts —
// keep the two in sync if the mapping changes.
const SECTION_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  target_market: Target,
  competitive: TrendingUp,
  niche_services: Layers,
  seo_aio_geo: Search,
  mobile: Smartphone,
  speed: Gauge,
  tech_stack: Server,
  site_health: ShieldCheck,
  content_library: Library,
  digital_intelligence: Globe,
  social_presence: MapPin,
  team_social: Users,
  narrative_recs: Sparkles,
  recommendations: ListChecks,
  change: Activity,
  page_inventory: FileText,
}

/** Circular icon chip echoing the brand graphic's badge. `sm` is the inline
 * accent on section headers; `lg` is the hero badge that overlaps the card.
 * Unmapped keys fall back to the magnifying glass (the audit brandmark). */
export function IconChip({ iconKey, size = 'sm' }: { iconKey?: string; size?: 'sm' | 'lg' }) {
  const Icon: LucideIcon = (iconKey ? SECTION_ICONS[iconKey] : undefined) ?? Search
  if (size === 'lg') {
    return (
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border-4 border-surface-card bg-brand-cyan text-text-inverse shadow-cyan-base">
        <Icon className="h-7 w-7" strokeWidth={2.25} aria-hidden />
      </span>
    )
  }
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-cyan/10 text-brand-cyan">
      <Icon className="h-4 w-4" strokeWidth={2.25} aria-hidden />
    </span>
  )
}

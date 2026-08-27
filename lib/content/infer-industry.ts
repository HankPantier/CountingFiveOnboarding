import type { SessionSchema } from '@/types/session-schema'
import { DEFAULT_INDUSTRY, type Industry } from './industries'

// Infers the vertical a client belongs to from its MBP. Today every firm on the
// platform is a CPA / accounting practice, so this deterministically resolves to
// 'tax-accounting' — but the seam exists (and reads niches/services/business) so
// that when the roster widens to other verticals the classifier can grow here
// without touching every call site. Used to:
//   - tag single-client resource ideas at generation time, and
//   - default the industry filter when picking library content during onboarding.
export function inferSessionIndustry(_schema: SessionSchema): Industry {
  void _schema
  return DEFAULT_INDUSTRY
}

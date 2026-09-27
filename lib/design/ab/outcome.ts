// Pure. How the design-model A/B script words a call that produced nothing
// usable: an account-level provider rejection (usage limit, credits, key,
// permission — lib/ai/provider-rejection.ts) gets the SAME specific message the
// Studio shows (providerRejectionMessage), never the generic stop reason.
import type { ProviderRejection } from '@/lib/ai/provider-rejection'
import { providerRejectionMessage } from '../provider-rejection-message'

export type AbCallOutcome = { stoppedReason?: string | null; rejection?: ProviderRejection | null }

// The provider's specific message, or null when the call wasn't rejected.
export function rejectionText(r: AbCallOutcome | null | undefined): string | null {
  return r?.rejection ? providerRejectionMessage(r.rejection) : null
}

// A generation / revision that returned no concept and no validation errors.
export function noUsableAnswerText(r: AbCallOutcome): string {
  return rejectionText(r) ?? `No usable answer (${r.stoppedReason ?? 'no_output'}).`
}

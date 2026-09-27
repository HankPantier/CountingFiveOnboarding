// Pure + client-safe. What the Studio (and the design-model A/B report) shows
// when the AI provider refused the account — never the key, never the raw
// request. Re-exported from model-call.ts.
import type { ProviderRejection } from '@/lib/ai/provider-rejection'

export function providerRejectionMessage(r: ProviderRejection): string {
  switch (r.kind) {
    case 'usage_limit':
      return `The AI provider rejected the request: API usage limit reached${r.resetDate ? ` (access returns ${r.resetDate})` : ''}. Raise the limit in the Anthropic Console, then press Retry.`
    case 'credit':
      return 'The AI provider rejected the request: the account is out of API credits. Add credits in the Anthropic Console, then press Retry.'
    case 'auth':
      return 'The AI provider rejected the API key — check ANTHROPIC_API_KEY, then press Retry.'
    case 'permission':
      return "The AI provider refused access (permission denied) — check the API key's workspace and model access in the Anthropic Console, then press Retry."
  }
}

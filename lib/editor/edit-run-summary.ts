// Pure summary of what an "Edit content with AI" turn actually did, so the UI
// can report the truth instead of implying a full save when only some edits
// landed (or the run was truncated by the step cap). Counts the commit-tool
// outputs on the last assistant turn; `finishReason` comes from the response
// message metadata (see app/api/edit/[id]/chat/route.ts).

export interface EditRunDetails {
  // Per-phrase removals from remove_text (summed across calls this turn).
  removed: { find: string; removed: number }[]
  dashesStripped: number
  // Phrases still present on the page after the pass (a variant the find missed).
  residual: { find: string; remaining: number }[]
  // Phrases that also live in a firm-wide source (brand.json / firm profile) and
  // will reappear on rebuild.
  firmWide: { find: string; source: string; remaining: number }[]
}

export interface EditRunSummary {
  applied: number
  failed: number
  // The model was stopped while still issuing tool calls (hit the step cap),
  // so more edits were likely intended than were applied.
  incomplete: boolean
  // Present when the turn used remove_text — a specific breakdown of what was
  // removed and what still remains, so the UI can report the exact outcome.
  details?: EditRunDetails
}

// Message-part types whose successful output means a file was committed to the
// draft. Kept in sync with the tools in the editor chat route.
const COMMIT_TOOL_TYPES = ['tool-apply_edit', 'tool-set_faq', 'tool-update_firm_contact', 'tool-remove_text']

interface RemoveTextOutput {
  success?: boolean
  error?: string
  applied?: { find: string; removed: number }[]
  dashesStripped?: number
  residual?: { find: string; remaining: number }[]
  firmWide?: { find: string; source: string; remaining: number }[]
}

interface ToolPartLike {
  type?: string
  output?: unknown
  result?: unknown
}

export function summarizeEditRun(parts: ToolPartLike[] | undefined, finishReason?: string): EditRunSummary {
  let applied = 0
  let failed = 0
  const removedByFind = new Map<string, number>()
  let dashesStripped = 0
  const residual: EditRunDetails['residual'] = []
  const firmWide: EditRunDetails['firmWide'] = []
  let sawRemoveText = false

  for (const p of parts ?? []) {
    if (!p?.type || !COMMIT_TOOL_TYPES.includes(p.type)) continue
    // The SDK exposes a completed tool result as `output` (or legacy `result`).
    const out = (p.output ?? p.result) as RemoveTextOutput | undefined
    if (!out) continue
    if (out.error || out.success === false) {
      failed++
      continue
    }
    applied++
    if (p.type === 'tool-remove_text') {
      sawRemoveText = true
      for (const a of out.applied ?? []) {
        removedByFind.set(a.find, (removedByFind.get(a.find) ?? 0) + a.removed)
      }
      dashesStripped += out.dashesStripped ?? 0
      if (out.residual) residual.push(...out.residual)
      if (out.firmWide) firmWide.push(...out.firmWide)
    }
  }

  const summary: EditRunSummary = { applied, failed, incomplete: finishReason === 'tool-calls' }
  if (sawRemoveText) {
    summary.details = {
      removed: [...removedByFind.entries()].map(([find, removed]) => ({ find, removed })),
      dashesStripped,
      residual,
      firmWide,
    }
  }
  return summary
}

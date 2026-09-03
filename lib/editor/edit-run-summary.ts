// Pure summary of what an "Edit content with AI" turn actually did, so the UI
// can report the truth instead of implying a full save when only some edits
// landed (or the run was truncated by the step cap). Counts the commit-tool
// outputs on the last assistant turn; `finishReason` comes from the response
// message metadata (see app/api/edit/[id]/chat/route.ts).

export interface EditRunSummary {
  applied: number
  failed: number
  // The model was stopped while still issuing tool calls (hit the step cap),
  // so more edits were likely intended than were applied.
  incomplete: boolean
}

// Message-part types whose successful output means a file was committed to the
// draft. Kept in sync with the tools in the editor chat route.
const COMMIT_TOOL_TYPES = ['tool-apply_edit', 'tool-set_faq', 'tool-update_firm_contact']

interface ToolPartLike {
  type?: string
  output?: unknown
  result?: unknown
}

export function summarizeEditRun(parts: ToolPartLike[] | undefined, finishReason?: string): EditRunSummary {
  let applied = 0
  let failed = 0
  for (const p of parts ?? []) {
    if (!p?.type || !COMMIT_TOOL_TYPES.includes(p.type)) continue
    // The SDK exposes a completed tool result as `output` (or legacy `result`).
    const out = (p.output ?? p.result) as { success?: boolean; error?: string } | undefined
    if (!out) continue
    if (out.error || out.success === false) failed++
    else applied++
  }
  return { applied, failed, incomplete: finishReason === 'tool-calls' }
}

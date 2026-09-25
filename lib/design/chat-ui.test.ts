import { describe, it, expect } from 'vitest'
import type { DesignChatMessage } from './chat-types'
import { chatBlocks, chatRequestErrorText, committedVersionNos, lastAssistant, messageCommitted, restoresComposer } from './chat-ui'

const msg = (parts: unknown[], role: 'user' | 'assistant' = 'assistant'): DesignChatMessage => ({ id: 'm', role, parts: parts as DesignChatMessage['parts'] })

describe('chatBlocks', () => {
  it('turns tool parts into edit chips, previews and notices', () => {
    const blocks = chatBlocks(
      msg([
        { type: 'text', text: 'Calming the cards.' },
        { type: 'tool-set_palette', toolCallId: 'a', state: 'output-available', input: { action: '#0a7c86' }, output: { ok: true, changed: true } },
        { type: 'tool-set_block_css', toolCallId: 'b', state: 'output-available', input: { target: 'service-cards', css: 'x' }, output: { ok: false, error: 'CSS rejected' } },
        { type: 'tool-render_preview', toolCallId: 'c', state: 'input-available', input: {} },
        {
          type: 'tool-render_preview',
          toolCallId: 'd',
          state: 'output-available',
          input: {},
          output: { ok: true, previewNo: 1, page: '/', shots: [{ viewport: 'desktop', url: 'https://s/1' }, { viewport: 'mobile', url: null }], gateFailures: ['f'], warnings: [] },
        },
        { type: 'tool-commit_version', toolCallId: 'e', state: 'output-available', input: { summary: 'x' }, output: { ok: true, versionId: 'v', versionNo: 7, changedPaths: [], warnings: ['w'] } },
        { type: 'data-design-commit', data: { status: 'blocked', error: 'Not saved — x', failures: ['f1'] } },
      ])
    )
    expect(blocks).toEqual([
      { kind: 'text', text: 'Calming the cards.' },
      { kind: 'edit', label: 'Palette', ok: true, detail: 'action #0a7c86' },
      { kind: 'edit', label: 'Block CSS', ok: false, detail: 'CSS rejected' },
      { kind: 'working', label: 'Rendering a preview…' },
      { kind: 'preview', previewNo: 1, page: '/', shots: [{ viewport: 'desktop', url: 'https://s/1' }], gateFailures: ['f'], warnings: [] },
      { kind: 'notice', tone: 'success', text: 'Saved to the draft as v7', items: ['w'] },
      { kind: 'notice', tone: 'error', text: 'Not saved — x', items: ['f1'] },
    ])
  })
  it('reports a failed preview and an auto-commit', () => {
    expect(chatBlocks(msg([{ type: 'tool-render_preview', toolCallId: 'x', state: 'output-available', input: {}, output: { ok: false, error: 'The render timed out.' } }]))).toEqual([
      { kind: 'notice', tone: 'warning', text: 'Preview failed: The render timed out.', items: [] },
    ])
    expect(chatBlocks(msg([{ type: 'data-design-commit', data: { status: 'committed', versionId: 'v', versionNo: 8, changedPaths: [], warnings: [], auto: true } }]))).toEqual([
      { kind: 'notice', tone: 'success', text: 'Saved to the draft as v8 (end of reply)', items: [] },
    ])
  })
})

describe('commit detection', () => {
  it('finds tool and auto commits; ignores refusals', () => {
    const m = msg([
      { type: 'tool-commit_version', toolCallId: 'e', state: 'output-available', input: {}, output: { ok: true, versionId: 'v', versionNo: 7, changedPaths: [], warnings: [] } },
      { type: 'data-design-commit', data: { status: 'committed', versionId: 'v2', versionNo: 8, changedPaths: [], warnings: [], auto: true } },
    ])
    expect(committedVersionNos(m)).toEqual([7, 8])
    expect(messageCommitted(msg([{ type: 'data-design-commit', data: { status: 'blocked', error: 'x', failures: [] } }]))).toBe(false)
    expect(lastAssistant([msg([], 'user'), { ...m, id: 'last' }, msg([], 'user')])?.id).toBe('last')
    expect(lastAssistant([])).toBeNull()
  })
})

describe('pre-stream request errors (PF12)', () => {
  it("shows the server's { error } text, not raw JSON", () => {
    expect(chatRequestErrorText(400, JSON.stringify({ error: 'One of the attached images is missing.' }))).toBe('One of the attached images is missing.')
    expect(chatRequestErrorText(409, '{"error":"The draft changed."}')).toBe('The draft changed.')
  })
  it('falls back to a friendly message for non-JSON or empty bodies', () => {
    expect(chatRequestErrorText(413, '<html>too large</html>')).toBe('That message is too large to send — try fewer or smaller images.')
    expect(chatRequestErrorText(502, '')).toBe('The chat request failed (502).')
    expect(chatRequestErrorText(400, '{"error":42}')).toBe('The chat request failed (400).')
  })
  it('restores the composer only for a refused (4xx) request', () => {
    expect(restoresComposer(400)).toBe(true)
    expect(restoresComposer(409)).toBe(true)
    expect(restoresComposer(499)).toBe(true)
    expect(restoresComposer(500)).toBe(false)
    expect(restoresComposer(503)).toBe(false)
  })
})

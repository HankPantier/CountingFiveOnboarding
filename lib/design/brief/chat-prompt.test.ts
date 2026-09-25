import { describe, it, expect } from 'vitest'
import { VALID } from '../__fixtures__/valid-bundle'
import { DEFAULT_CAPABILITIES, type DesignCapabilities } from '../run-types'
import { CSS_RULES_SECTION, TOKEN_CONTRACT } from './contract'
import { buildChatSystemStatic, buildChatTurnContext } from './chat-prompt'

const L2: DesignCapabilities = { level: 2, source: 'marker', templateVersion: '2', capabilities: ['fonts'] }
const SCHEMA = { business: { name: 'Acme CPA' }, _meta: { secret: 'zzz-meta-secret' }, mbp_content: 'zzz-raw-mbp' }
const base = { firmName: 'Acme CPA', schema: SCHEMA, designMd: null }

describe('buildChatSystemStatic', () => {
  it('is byte-stable for the same session + tier (cache prefix)', () => {
    expect(buildChatSystemStatic({ ...base, caps: DEFAULT_CAPABILITIES })).toBe(buildChatSystemStatic({ ...base, caps: { ...DEFAULT_CAPABILITIES } }))
  })
  it('carries the tools, the CSS rules and the token contract', () => {
    const s = buildChatSystemStatic({ ...base, caps: DEFAULT_CAPABILITIES })
    for (const t of ['set_palette', 'set_fonts', 'set_tokens', 'set_treatments', 'set_block_css', 'remove_block_css', 'render_preview', 'commit_version']) expect(s).toContain(t)
    expect(s).toContain(CSS_RULES_SECTION)
    expect(s).toContain(TOKEN_CONTRACT)
    expect(s).toContain('at most 2 times per turn')
    expect(s).not.toContain('style_axes')
  })
  it('states the font lock per tier', () => {
    expect(buildChatSystemStatic({ ...base, caps: DEFAULT_CAPABILITIES })).toContain('FONTS: LOCKED')
    expect(buildChatSystemStatic({ ...base, caps: L2 })).toContain('FONTS: unlocked')
  })
  it('never leaks _meta or mbp_content', () => {
    const s = buildChatSystemStatic({ ...base, caps: DEFAULT_CAPABILITIES })
    expect(s).not.toContain('zzz-meta-secret')
    expect(s).not.toContain('zzz-raw-mbp')
  })
})

describe('buildChatTurnContext', () => {
  const args = { bundle: VALID, latestVersionNo: 3, drift: 'in-sync' as const, page: '/services', lastTurnNote: null }
  it('shows the current levers + CSS budget, never schemaVersion/meta', () => {
    const t = buildChatTurnContext(args)
    expect(t).toContain('#003b71')
    expect(t).toContain('CSS BUDGET')
    expect(t).toContain('css.blocks.hero')
    expect(t).not.toContain('schemaVersion')
    expect(t).not.toContain('claude-opus')
    expect(t).toContain('v3')
    expect(t).toContain('/services')
  })
  it('explains drift and carries the last-turn note', () => {
    const t = buildChatTurnContext({ ...args, drift: 'drifted', lastTurnNote: 'NOTE: your previous turn’s changes were NOT saved (x).' })
    expect(t).toMatch(/changed outside the Studio/)
    expect(t).toContain('were NOT saved')
    expect(buildChatTurnContext({ ...args, latestVersionNo: null })).toContain('VERSIONS: none yet.')
  })
})

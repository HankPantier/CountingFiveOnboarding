import { describe, it, expect } from 'vitest'
import { abUsage, criticIsContender, parseAbArgs, DEFAULT_AB_CAP_USD, DEFAULT_AB_CONCEPTS } from './args'

const SID = '0b7c6f2e-4a1d-4c9e-9f3b-2d5e8a1c7b40'
const DEFAULTS = { models: ['claude-opus-5-5', 'claude-fable-5-1'], critic: 'claude-sonnet-5' }

describe('parseAbArgs', () => {
  it('no args or --help ⇒ help', () => {
    expect(parseAbArgs([], DEFAULTS)).toEqual({ kind: 'help' })
    expect(parseAbArgs([SID, '--help'], DEFAULTS)).toEqual({ kind: 'help' })
  })

  it('applies the defaults', () => {
    const r = parseAbArgs([SID], DEFAULTS)
    expect(r).toEqual({
      kind: 'ok',
      args: {
        sessionId: SID,
        concepts: DEFAULT_AB_CONCEPTS,
        models: DEFAULTS.models,
        pages: null,
        capUsd: DEFAULT_AB_CAP_USD,
        critic: true,
        criticModel: 'claude-sonnet-5',
        out: null,
        brief: null,
        palette: 'evolve',
        inputs: { kind: 'all' },
      },
    })
  })

  it('parses every option', () => {
    const r = parseAbArgs(
      [SID, '--concepts', '3', '--models', 'a,b,a', '--pages', '/,/services', '--cap', '7.5', '--no-critic', '--critic', 'claude-opus-5-5', '--out', 'x/y', '--brief', ' bold ', '--palette', 'free', '--inputs', 'none'],
      DEFAULTS
    )
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.args).toMatchObject({ concepts: 3, models: ['a', 'b'], pages: ['/', '/services'], capUsd: 7.5, critic: false, criticModel: 'claude-opus-5-5', out: 'x/y', brief: 'bold', palette: 'free', inputs: { kind: 'none' } })
  })

  it('rejects bad values', () => {
    for (const argv of [
      ['not-a-uuid'],
      [SID, '--concepts', '9'],
      [SID, '--cap', '0'],
      [SID, '--cap', '1000'],
      [SID, '--pages', 'services'],
      [SID, '--pages', '/../x'],
      [SID, '--palette', 'wild'],
      [SID, '--inputs', 'abc'],
      [SID, '--models', ','],
      [SID, '--cap'],
      [SID, '--critic', 'a,b'],
      [SID, '--bogus', '1'],
      [SID, SID],
      ['--no-critic'],
    ]) {
      expect(parseAbArgs(argv, DEFAULTS).kind, argv.join(' ')).toBe('error')
    }
  })

  it('usage names the defaults and the Chromium requirement', () => {
    const u = abUsage(DEFAULTS)
    expect(u).toContain('claude-opus-5-5,claude-fable-5-1')
    expect(u).toContain('CHROMIUM_EXECUTABLE_PATH')
    expect(u).toContain('default claude-sonnet-5')
    expect(u).toContain('design_concept / design_critique')
  })

  it('flags a judge that is also a contender (only when the critic runs)', () => {
    expect(criticIsContender({ critic: true, criticModel: 'claude-sonnet-5', models: DEFAULTS.models })).toBe(false)
    expect(criticIsContender({ critic: true, criticModel: 'claude-opus-5-5', models: DEFAULTS.models })).toBe(true)
    expect(criticIsContender({ critic: false, criticModel: 'claude-opus-5-5', models: DEFAULTS.models })).toBe(false)
  })
})

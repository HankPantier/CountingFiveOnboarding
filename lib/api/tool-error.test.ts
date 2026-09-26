import { describe, expect, it, vi } from 'vitest'
import { RequestError } from '@octokit/request-error'
import { StaleShaError } from '@/lib/github/repo-files'
import { STALE_TOOL_MESSAGE, ToolUserError, toolError } from './tool-error'

describe('toolError', () => {
  it('never streams raw GitHub text to the browser', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = new RequestError('Resource not accessible by integration - https://docs.github.com/rest', 403, {
      request: { method: 'PUT', url: 'https://api.github.com', headers: {} },
    })
    expect(toolError('edit:chat', raw, 'Failed to save the edit.')).toEqual({ error: 'Failed to save the edit.' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('passes through messages written for the user (YAML guard)', () => {
    expect(toolError('edit:chat', new ToolUserError('Frontmatter is invalid YAML: quote the title'), 'x')).toEqual({
      error: 'Frontmatter is invalid YAML: quote the title',
    })
  })

  it('maps a stale sha to the fixed conflict message', () => {
    expect(toolError('edit:chat', new StaleShaError('p', 's', 'secret body'), 'x')).toEqual({ error: STALE_TOOL_MESSAGE })
  })
})

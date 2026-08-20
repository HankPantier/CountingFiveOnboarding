import { describe, expect, it } from 'vitest'
import { containsDeployCommit, DEPLOY_COMMIT_PREFIX } from './deploy-commit'

describe('containsDeployCommit', () => {
  it('detects the deploy commit even when it is NOT at HEAD (the bug)', () => {
    // Real Accord-Advisors draft order: deploy landed, then the pipeline stacked
    // site-settings commits on top within ~1s. A HEAD-only check missed it.
    const ahead = [
      'Seed site from HankPantier/CountingFiveTemplate',
      'Deploy packaged content via admin (webhank@gmail.com)',
      'Set siteUrl to https://rootadvisors.com',
      'Set booking to none',
    ]
    expect(containsDeployCommit(ahead)).toBe(true)
  })

  it('detects the deploy commit when it is at HEAD', () => {
    expect(containsDeployCommit(['Deploy packaged content via admin'])).toBe(true)
  })

  it('is false when no deploy commit is present (push failed / not yet landed)', () => {
    expect(
      containsDeployCommit(['Seed site from template', 'Set siteUrl to https://x.com'])
    ).toBe(false)
  })

  it('is false for an empty ahead set and tolerates null/undefined entries', () => {
    expect(containsDeployCommit([])).toBe(false)
    expect(containsDeployCommit([null, undefined])).toBe(false)
  })

  it('matches on the documented prefix', () => {
    expect(containsDeployCommit([`${DEPLOY_COMMIT_PREFIX} via admin (x@y.com)`])).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import {
  hasCapability,
  hasContentAccess,
  canPublish,
  hasOnboardingAccess,
  type CurrentUser,
  type Capability,
} from './access'

const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
  id: 'u',
  role: 'member',
  isAdmin: false,
  capabilities: [],
  ...over,
})

const admin = user({ role: 'admin', isAdmin: true, capabilities: ['manager', 'auditor', 'editor'] })
const manager = user({ capabilities: ['manager'] })
const editor = user({ capabilities: ['editor'] })
const auditor = user({ capabilities: ['auditor'] })

describe('capability model — the core authorization rules', () => {
  it('admin passes every predicate', () => {
    expect(hasContentAccess(admin)).toBe(true)
    expect(canPublish(admin)).toBe(true)
    expect(hasOnboardingAccess(admin)).toBe(true)
    for (const cap of ['manager', 'auditor', 'editor'] as Capability[]) {
      expect(hasCapability(admin, cap)).toBe(true)
    }
  })

  it('manager: content access + publish + onboarding', () => {
    expect(hasContentAccess(manager)).toBe(true)
    expect(canPublish(manager)).toBe(true)
    expect(hasOnboardingAccess(manager)).toBe(true)
  })

  it('editor: content access but DENIED publish and onboarding', () => {
    expect(hasContentAccess(editor)).toBe(true)
    expect(canPublish(editor)).toBe(false)
    expect(hasOnboardingAccess(editor)).toBe(false)
  })

  it('auditor: no content access, no publish', () => {
    expect(hasContentAccess(auditor)).toBe(false)
    expect(canPublish(auditor)).toBe(false)
    expect(hasCapability(auditor, 'auditor')).toBe(true)
  })

  it('a member with no capabilities is denied everything non-audit', () => {
    const bare = user()
    expect(hasContentAccess(bare)).toBe(false)
    expect(canPublish(bare)).toBe(false)
    expect(hasOnboardingAccess(bare)).toBe(false)
    expect(hasCapability(bare, 'manager')).toBe(false)
  })
})

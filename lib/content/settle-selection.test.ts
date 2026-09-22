import { describe, expect, it } from 'vitest'
import { settleSelectionFromIdea } from './library-inclusion'

describe('settleSelectionFromIdea', () => {
  // The hang this fixes: TruCount had 5 selections sitting at 'pending' and 1 at
  // 'error' whose ideas were already `complete` with a committed draft_path —
  // some since three weeks earlier. Reconciliation only covered 'drafting' rows,
  // so they never settled, and `terminal = pending + drafting === 0` kept the
  // publish gate shut on articles that were already written.
  it('settles a pending selection whose idea already drafted', () => {
    expect(settleSelectionFromIdea('pending', 'complete')).toEqual({ status: 'complete' })
  })

  it('settles an errored selection whose idea already drafted', () => {
    // The selection's error is stale — the idea owns the draft and it succeeded.
    expect(settleSelectionFromIdea('error', 'complete')).toEqual({ status: 'complete' })
  })

  it('still settles the in-flight case it always covered', () => {
    expect(settleSelectionFromIdea('drafting', 'complete')).toEqual({ status: 'complete' })
    expect(settleSelectionFromIdea('drafting', 'error', 'unparseable output')).toEqual({
      status: 'error',
      error: 'unparseable output',
    })
  })

  it('supplies a message when an errored idea carries none', () => {
    expect(settleSelectionFromIdea('drafting', 'error', null)).toEqual({
      status: 'error',
      error: 'Generation failed',
    })
  })

  it('leaves a pending/errored row alone when the idea also errored, so retry re-drafts it', () => {
    expect(settleSelectionFromIdea('pending', 'error', 'boom')).toBeNull()
    expect(settleSelectionFromIdea('error', 'error', 'boom')).toBeNull()
  })

  it('leaves a row alone while its idea is still working', () => {
    expect(settleSelectionFromIdea('drafting', 'running')).toBeNull()
    expect(settleSelectionFromIdea('pending', 'pending')).toBeNull()
    expect(settleSelectionFromIdea('pending', null)).toBeNull()
    expect(settleSelectionFromIdea('pending', undefined)).toBeNull()
  })

  it('never touches an already-complete selection', () => {
    expect(settleSelectionFromIdea('complete', 'error', 'boom')).toBeNull()
    expect(settleSelectionFromIdea('complete', 'complete')).toBeNull()
  })
})

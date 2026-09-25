import { describe, it, expect } from 'vitest'
import { fitWithinMaxEdge } from './downscale-math'

describe('fitWithinMaxEdge', () => {
  it('leaves an image unchanged when already within the cap', () => {
    expect(fitWithinMaxEdge(1200, 800, 2400)).toEqual({ width: 1200, height: 800 })
  })

  it('leaves an image unchanged when exactly at the cap', () => {
    expect(fitWithinMaxEdge(2400, 1200, 2400)).toEqual({ width: 2400, height: 1200 })
  })

  it('scales down a wide image so the long edge matches the cap', () => {
    expect(fitWithinMaxEdge(4800, 2400, 2400)).toEqual({ width: 2400, height: 1200 })
  })

  it('scales down a tall image so the long edge matches the cap', () => {
    expect(fitWithinMaxEdge(1000, 5000, 2500)).toEqual({ width: 500, height: 2500 })
  })

  it('rounds to whole pixels', () => {
    expect(fitWithinMaxEdge(4801, 3000, 2400)).toEqual({ width: 2400, height: 1500 })
  })

  it('never enlarges a small image', () => {
    expect(fitWithinMaxEdge(100, 50, 2400)).toEqual({ width: 100, height: 50 })
  })

  it('treats a non-positive max edge as a no-op', () => {
    expect(fitWithinMaxEdge(4800, 2400, 0)).toEqual({ width: 4800, height: 2400 })
  })
})

import { describe, expect, it } from 'vitest'
import { readCappedBody } from './crawl'

const MAX = 5 * 1024 * 1024

describe('readCappedBody', () => {
  it('reads a small body in full', async () => {
    const res = new Response('hello world')
    expect(await readCappedBody(res)).toBe('hello world')
  })

  it('caps an oversized body instead of buffering it all', async () => {
    // Stream the body in 512KB chunks so the cap trips mid-stream.
    const chunk = 'a'.repeat(512 * 1024)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 12 * 1024 * 1024) {
          controller.close()
          return
        }
        controller.enqueue(new TextEncoder().encode(chunk))
        sent += chunk.length
      },
    })
    const res = new Response(stream)
    const body = await readCappedBody(res)
    expect(body.length).toBeLessThanOrEqual(MAX)
    expect(body.length).toBeGreaterThan(0)
  })
})

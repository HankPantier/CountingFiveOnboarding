import { describe, expect, it } from 'vitest'
import { NextResponse } from 'next/server'
import { readJsonBody } from './_json'

const post = (body: string) =>
  new Request('http://test/x', { method: 'POST', body })

describe('readJsonBody', () => {
  it('parses a valid JSON body and returns the typed value', async () => {
    const res = await readJsonBody<{ a: number }>(post(JSON.stringify({ a: 1 })))
    expect(res).not.toBeInstanceOf(NextResponse)
    expect((res as { a: number }).a).toBe(1)
  })

  it('returns a 400 NextResponse on malformed JSON', async () => {
    const res = await readJsonBody(post('{ not json'))
    expect(res).toBeInstanceOf(NextResponse)
    expect((res as NextResponse).status).toBe(400)
    const body = (await (res as NextResponse).json()) as { error: string }
    expect(body.error).toBe('Invalid JSON body')
  })

  it('returns a 400 NextResponse on an empty body', async () => {
    const res = await readJsonBody(new Request('http://test/x', { method: 'POST' }))
    expect(res).toBeInstanceOf(NextResponse)
    expect((res as NextResponse).status).toBe(400)
  })
})

import { describe, expect, it } from 'vitest'
import { type NodeResponseLike, toNodeMiddleware } from './node'

function mockRes() {
  const headers: Record<string, string | number | readonly string[]> = {}
  let body = ''
  const res: NodeResponseLike & {
    headers: typeof headers
    body: () => string
  } = {
    statusCode: 0,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value
    },
    end(chunk) {
      body = chunk ?? ''
    },
    headers,
    body: () => body,
  }
  return res
}

const req = { method: 'GET', url: '/x', headers: { host: 'localhost:5173' } }

describe('toNodeMiddleware', () => {
  it('writes the Response (status, body, multiple cookies) when handle returns one', async () => {
    const mw = toNodeMiddleware(async () => {
      const h = new Headers({ 'content-type': 'text/plain' })
      h.append('set-cookie', 'a=1')
      h.append('set-cookie', 'b=2')
      return new Response('hi', { status: 201, headers: h })
    })
    const res = mockRes()
    await new Promise<void>((resolve) => {
      mw(req, res, () => resolve())
      // give the internal async IIFE a tick to finish
      queueMicrotask(() => setTimeout(resolve, 5))
    })
    expect(res.statusCode).toBe(201)
    expect(res.body()).toBe('hi')
    expect(res.headers['set-cookie']).toEqual(['a=1', 'b=2'])
  })

  it('calls next() when handle returns null', async () => {
    const mw = toNodeMiddleware(async () => null)
    const res = mockRes()
    const called = await new Promise<boolean>((resolve) => {
      mw(req, res, () => resolve(true))
      setTimeout(() => resolve(false), 20)
    })
    expect(called).toBe(true)
  })

  it('404s without a next callback', async () => {
    const mw = toNodeMiddleware(async () => null)
    const res = mockRes()
    mw(req, res)
    await new Promise((r) => setTimeout(r, 10))
    expect(res.statusCode).toBe(404)
  })
})

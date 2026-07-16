import { describe, expect, it } from 'vitest'
import {
  __internal,
  createSessionStore,
  type SessionStoreOptions,
} from './session'
import type { SessionData } from './types'

const { parseCookies, serializeCookie } = __internal

const baseOpts: SessionStoreOptions = {
  secret: 'a-very-long-test-secret-value-1234567890',
  cookieName: 'ferry_session',
  path: '/submit',
  ttlSeconds: 3600,
  secure: true,
}

/** Extract the raw cookie value from a Set-Cookie header string. */
function cookieValue(setCookie: string): string {
  const first = setCookie.split(';')[0] ?? ''
  return first.slice(first.indexOf('=') + 1)
}

/** Build a Request carrying a cookie header. */
function requestWithCookie(name: string, value: string): Request {
  return new Request('https://example.com/submit', {
    headers: { cookie: `${name}=${value}` },
  })
}

describe('cookie helpers', () => {
  it('round-trips names and values', () => {
    const parsed = parseCookies('a=1; ferry_session=abc%20def; b=2')
    expect(parsed.a).toBe('1')
    expect(parsed.ferry_session).toBe('abc def')
    expect(parsed.b).toBe('2')
  })

  it('serializes with the expected attributes', () => {
    const c = serializeCookie('ferry_session', 'v v', {
      path: '/submit',
      secure: true,
      maxAge: 60,
    })
    expect(c).toContain('ferry_session=v%20v')
    expect(c).toContain('Path=/submit')
    expect(c).toContain('HttpOnly')
    expect(c).toContain('SameSite=Lax')
    expect(c).toContain('Secure')
    expect(c).toContain('Max-Age=60')
  })

  it('omits Secure when disabled', () => {
    const c = serializeCookie('x', 'y', { path: '/', secure: false })
    expect(c).not.toContain('Secure')
  })
})

describe('session store', () => {
  const data: SessionData = {
    state: 'abc123',
    pkceVerifier: 'verifier-value',
    pending: 'hackclub',
    authToken: 'OwpFjcAKOj2uWza5',
  }

  it('seals and opens a round-trip', async () => {
    const store = createSessionStore(baseOpts)
    const setCookie = await store.commit(data)
    const value = cookieValue(setCookie)

    const read = await store.read(requestWithCookie(baseOpts.cookieName, value))
    if (!read) throw new Error('expected a session to be read back')
    expect(read.state).toBe('abc123')
    expect(read.pkceVerifier).toBe('verifier-value')
    expect(read.pending).toBe('hackclub')
    expect(read.authToken).toBe('OwpFjcAKOj2uWza5')
    expect(typeof read.exp).toBe('number')
  })

  it('returns null when there is no cookie', async () => {
    const store = createSessionStore(baseOpts)
    const req = new Request('https://example.com/submit')
    expect(await store.read(req)).toBeNull()
  })

  it('produces an opaque cookie value (not plaintext)', async () => {
    const store = createSessionStore(baseOpts)
    const value = cookieValue(await store.commit(data))
    expect(value).not.toContain('OwpFjcAKOj2uWza5')
    expect(value).not.toContain('hackclub')
  })

  it('rejects a tampered cookie', async () => {
    const store = createSessionStore(baseOpts)
    const value = cookieValue(await store.commit(data))
    // flip a character in the middle of the ciphertext
    const mid = Math.floor(value.length / 2)
    const flipped =
      value.slice(0, mid) +
      (value[mid] === 'A' ? 'B' : 'A') +
      value.slice(mid + 1)
    const read = await store.read(
      requestWithCookie(baseOpts.cookieName, flipped)
    )
    expect(read).toBeNull()
  })

  it('cannot be opened with a different secret', async () => {
    const store = createSessionStore(baseOpts)
    const value = cookieValue(await store.commit(data))

    const other = createSessionStore({
      ...baseOpts,
      secret: 'a-totally-different-secret-0987654321xx',
    })
    const read = await other.read(requestWithCookie(baseOpts.cookieName, value))
    expect(read).toBeNull()
  })

  it('treats expired sessions as absent', async () => {
    const store = createSessionStore({ ...baseOpts, ttlSeconds: -1 })
    const value = cookieValue(await store.commit(data))
    const read = await store.read(requestWithCookie(baseOpts.cookieName, value))
    expect(read).toBeNull()
  })

  it('destroy() clears the cookie', () => {
    const store = createSessionStore(baseOpts)
    const c = store.destroy()
    expect(c).toContain('ferry_session=')
    expect(c).toContain('Max-Age=0')
  })

  it('rejects a garbage cookie value without throwing', async () => {
    const store = createSessionStore(baseOpts)
    const read = await store.read(
      requestWithCookie(baseOpts.cookieName, 'not-valid-@@@')
    )
    expect(read).toBeNull()
  })
})

import { createCipher } from './crypto'
import type { SessionData } from './types'

/**
 * Encrypted session cookie. The cookie holds only the minimal in-flight state
 * ({@link SessionData}); raw OAuth access tokens never touch it. Encryption uses
 * a session-purpose subkey derived from the master secret (see `crypto.ts`).
 */

const SESSION_PURPOSE = 'ferry/session/v1'

// --- cookies ---

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (!name) continue
    out[name] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

interface CookieAttrs {
  path: string
  secure: boolean
  maxAge?: number
}

function serializeCookie(
  name: string,
  value: string,
  attrs: CookieAttrs
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${attrs.path}`)
  parts.push('HttpOnly')
  parts.push('SameSite=Lax')
  if (attrs.secure) parts.push('Secure')
  if (typeof attrs.maxAge === 'number') parts.push(`Max-Age=${attrs.maxAge}`)
  return parts.join('; ')
}

// --- store ---

export interface SessionStoreOptions {
  secret: string
  cookieName: string
  path: string
  ttlSeconds: number
  secure: boolean
}

export interface SessionStore {
  /** Read and decrypt the session from a request. Returns `null` if absent,
   * expired, or tampered. */
  read(request: Request): Promise<SessionData | null>
  /** Encrypt `data` and return a `Set-Cookie` header value (with a fresh TTL). */
  commit(data: SessionData): Promise<string>
  /** Return a `Set-Cookie` header value that clears the session cookie. */
  destroy(): string
}

/** Create a session store bound to a secret and cookie options. */
export function createSessionStore(opts: SessionStoreOptions): SessionStore {
  const cipher = createCipher(opts.secret, SESSION_PURPOSE)
  const attrs: CookieAttrs = { path: opts.path, secure: opts.secure }

  return {
    async read(request) {
      const raw = parseCookies(request.headers.get('cookie'))[opts.cookieName]
      if (!raw) return null
      const json = await cipher.open(raw)
      if (json === null) return null
      try {
        const data = JSON.parse(json) as SessionData
        if (typeof data.exp === 'number' && data.exp * 1000 < Date.now()) {
          return null
        }
        return data
      } catch {
        return null
      }
    },

    async commit(data) {
      const payload: SessionData = {
        ...data,
        exp: Math.floor(Date.now() / 1000) + opts.ttlSeconds,
      }
      const value = await cipher.seal(JSON.stringify(payload))
      return serializeCookie(opts.cookieName, value, {
        ...attrs,
        maxAge: opts.ttlSeconds,
      })
    },

    destroy() {
      return serializeCookie(opts.cookieName, '', { ...attrs, maxAge: 0 })
    },
  }
}

// exported for unit tests
export const __internal = { parseCookies, serializeCookie }

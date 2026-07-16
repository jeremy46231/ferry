import type { SessionData } from './types'

/**
 * Encrypted session cookie backed by Web Crypto (AES-GCM). Works on any runtime
 * with a standard `crypto.subtle` (Node 18+, Bun, Deno, Workers, edge).
 *
 * The cookie holds only the minimal in-flight state ({@link SessionData}); raw
 * OAuth access tokens never touch it.
 */

// --- base64url helpers (Web-standard btoa/atob) ---

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// --- crypto ---

const IV_BYTES = 12

const encoder = new TextEncoder()

/** UTF-8 encode into an ArrayBuffer-backed view.
 * (`TextEncoder.encode` yields `Uint8Array<ArrayBufferLike>`, which TS 5.7+
 * won't accept as a `BufferSource`; re-wrapping gives an `ArrayBuffer` backing.) */
function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(s))
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest('SHA-256', utf8(secret))
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

async function seal(key: CryptoKey, data: SessionData): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plaintext = utf8(JSON.stringify(data))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  )
  const combined = new Uint8Array(iv.length + ct.length)
  combined.set(iv, 0)
  combined.set(ct, iv.length)
  return bytesToB64url(combined)
}

async function open(
  key: CryptoKey,
  value: string
): Promise<SessionData | null> {
  try {
    const raw = b64urlToBytes(value)
    if (raw.length <= IV_BYTES) return null
    const iv = raw.slice(0, IV_BYTES)
    const ct = raw.slice(IV_BYTES)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    const data = JSON.parse(new TextDecoder().decode(pt)) as SessionData
    if (typeof data.exp === 'number' && data.exp * 1000 < Date.now())
      return null
    return data
  } catch {
    // tampered, wrong key, malformed, or expired-and-unparsable → no session
    return null
  }
}

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
  const keyPromise = deriveKey(opts.secret)
  const attrs: CookieAttrs = { path: opts.path, secure: opts.secure }

  return {
    async read(request) {
      const raw = parseCookies(request.headers.get('cookie'))[opts.cookieName]
      if (!raw) return null
      return open(await keyPromise, raw)
    },

    async commit(data) {
      const payload: SessionData = {
        ...data,
        exp: Math.floor(Date.now() / 1000) + opts.ttlSeconds,
      }
      const value = await seal(await keyPromise, payload)
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

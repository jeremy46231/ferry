/**
 * Shared symmetric crypto built on Web Crypto.
 *
 * One master secret (`FERRY_SECRET`) is stretched into purpose-separated AES-GCM
 * keys via HKDF-SHA256, so the cookie key and the DB-token key are never the
 * same key. HKDF assumes a high-entropy secret (generate with
 * `openssl rand -hex 32`) — it is not a passphrase stretcher.
 */

const IV_BYTES = 12

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** UTF-8 encode into an ArrayBuffer-backed view (satisfies `BufferSource`). */
function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(s))
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Derive a purpose-specific AES-GCM key from the master secret via HKDF. */
async function deriveKey(secret: string, purpose: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    'HKDF',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: utf8(purpose),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export interface Cipher {
  /** Encrypt a string; returns base64url(iv ‖ ciphertext). */
  seal(plaintext: string): Promise<string>
  /** Decrypt a sealed string; returns null on any failure (tampered, wrong
   * key/purpose, malformed). */
  open(sealed: string): Promise<string | null>
}

/**
 * Create a {@link Cipher} bound to a master secret and a purpose label. Different
 * purposes yield independent keys, so a value sealed under one purpose cannot be
 * opened under another.
 */
export function createCipher(secret: string, purpose: string): Cipher {
  const keyPromise = deriveKey(secret, purpose)

  return {
    async seal(plaintext) {
      const key = await keyPromise
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
      const ct = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          key,
          utf8(plaintext)
        )
      )
      const combined = new Uint8Array(iv.length + ct.length)
      combined.set(iv, 0)
      combined.set(ct, iv.length)
      return bytesToB64url(combined)
    },

    async open(sealed) {
      try {
        const key = await keyPromise
        const raw = b64urlToBytes(sealed)
        if (raw.length <= IV_BYTES) return null
        const iv = raw.slice(0, IV_BYTES)
        const ct = raw.slice(IV_BYTES)
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
        return decoder.decode(pt)
      } catch {
        return null
      }
    },
  }
}

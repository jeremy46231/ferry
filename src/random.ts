/** Cryptographically-random helpers built on Web Crypto. */

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

/** Lowercase hex string of `bytes` random bytes (length = 2 × bytes). */
export function randomHex(bytes = 32): string {
  let out = ''
  for (const b of randomBytes(bytes)) out += b.toString(16).padStart(2, '0')
  return out
}

/** Opaque 128-bit token (32 hex chars) — used as the per-user `Auth Token`
 * that links a Fillout submission back to its Airtable User row. */
export function randomToken(): string {
  return randomHex(16)
}

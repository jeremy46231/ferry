import { describe, expect, it } from 'vitest'
import { createCipher } from './crypto'

const SECRET = 'a-very-long-master-secret-value-1234567890'

describe('createCipher()', () => {
  it('round-trips a value', async () => {
    const cipher = createCipher(SECRET, 'ferry/test/v1')
    const sealed = await cipher.seal('hello world')
    expect(sealed).not.toContain('hello')
    expect(await cipher.open(sealed)).toBe('hello world')
  })

  it('produces different ciphertext each time (random IV)', async () => {
    const cipher = createCipher(SECRET, 'ferry/test/v1')
    expect(await cipher.seal('x')).not.toBe(await cipher.seal('x'))
  })

  it('cannot be opened under a different purpose', async () => {
    const sealed = await createCipher(SECRET, 'ferry/a/v1').seal('secret-data')
    expect(await createCipher(SECRET, 'ferry/b/v1').open(sealed)).toBeNull()
  })

  it('cannot be opened with a different master secret', async () => {
    const sealed = await createCipher(SECRET, 'ferry/test/v1').seal(
      'secret-data'
    )
    const other = createCipher(
      'a-different-master-secret-0987654321xx',
      'ferry/test/v1'
    )
    expect(await other.open(sealed)).toBeNull()
  })

  it('returns null on tampered or garbage input', async () => {
    const cipher = createCipher(SECRET, 'ferry/test/v1')
    const sealed = await cipher.seal('data')
    const mid = Math.floor(sealed.length / 2)
    const flipped =
      sealed.slice(0, mid) +
      (sealed[mid] === 'A' ? 'B' : 'A') +
      sealed.slice(mid + 1)
    expect(await cipher.open(flipped)).toBeNull()
    expect(await cipher.open('not-valid-@@@')).toBeNull()
  })
})

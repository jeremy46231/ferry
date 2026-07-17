import { afterEach, describe, expect, it, vi } from 'vitest'
import { type AirtableConfig, findUserBySlackId, upsertUser } from './airtable'
import type { HcaIdentity } from './hca'

const cfg: AirtableConfig = {
  apiKey: 'key',
  baseId: 'appX',
  tables: {
    users: 'User',
    hackatimeProjects: 'Hackatime Projects',
    submissions: 'YSWS Project Submission',
    config: 'YSWS Config',
  },
}

const identity: HcaIdentity = {
  id: 'ident!abc',
  slack_id: 'U06UYA5GMB5',
  first_name: 'Jeremy',
  last_name: 'Woolley',
  primary_email: 'jeremy@example.com',
  birthday: '2000-01-01',
  addresses: [
    {
      line_1: '212 Battery St',
      line_2: '#3',
      city: 'Burlington',
      state: 'Vermont',
      postal_code: '05401',
      country: 'US',
      primary: true,
    },
  ],
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('findUserBySlackId()', () => {
  it('URL-encodes the table and queries by Slack ID', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      expect(url).toContain('/appX/User?')
      expect(url).toContain('filterByFormula=')
      expect(decodeURIComponent(url)).toContain("{Slack ID} = 'U06UYA5GMB5'")
      return json({ records: [{ id: 'rec1', fields: {} }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const rec = await findUserBySlackId(cfg, 'U06UYA5GMB5')
    expect(rec?.id).toBe('rec1')
  })

  it('returns null when no record matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ records: [] }))
    )
    expect(await findUserBySlackId(cfg, 'Uxxx')).toBeNull()
  })
})

describe('upsertUser()', () => {
  it('creates a new row with a minted Auth Token and mapped fields', async () => {
    let posted: { fields: Record<string, unknown> } | undefined
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'GET') return json({ records: [] })
        posted = JSON.parse(init?.body as string)
        return json({ id: 'recNew', fields: posted?.fields ?? {} })
      }
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await upsertUser(cfg, identity)
    expect(result.created).toBe(true)
    expect(result.authToken).toMatch(/^[0-9a-f]{32}$/)
    expect(posted?.fields['Slack ID']).toBe('U06UYA5GMB5')
    expect(posted?.fields['First Name']).toBe('Jeremy')
    expect(posted?.fields.Email).toBe('jeremy@example.com')
    expect(posted?.fields.Birthday).toBe('2000-01-01')
    expect(posted?.fields['Address (Line 1)']).toBe('212 Battery St')
    expect(posted?.fields['State / Province']).toBe('Vermont')
    expect(posted?.fields['Auth Token']).toBe(result.authToken)
  })

  it('updates an existing row and preserves its Auth Token', async () => {
    let patchedId: string | undefined
    let patched: { fields: Record<string, unknown> } | undefined
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'GET') {
          return json({
            records: [
              { id: 'recExisting', fields: { 'Auth Token': 'kept-token' } },
            ],
          })
        }
        expect(init?.method).toBe('PATCH')
        patchedId = String(input).split('/User/')[1]
        patched = JSON.parse(init?.body as string)
        return json({ id: 'recExisting', fields: patched?.fields ?? {} })
      }
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await upsertUser(cfg, identity)
    expect(result.created).toBe(false)
    expect(result.authToken).toBe('kept-token')
    expect(patchedId).toBe('recExisting')
    expect(patched?.fields['Auth Token']).toBe('kept-token')
    expect(patched?.fields['First Name']).toBe('Jeremy')
  })

  it('throws when the identity has no Slack ID', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(
      upsertUser(cfg, { ...identity, slack_id: undefined })
    ).rejects.toThrow(/Slack ID/)
  })
})

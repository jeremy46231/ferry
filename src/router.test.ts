import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFerry, type FerryConfig } from './index'
import { createCipher } from './lib/crypto'

const BASE = 'https://app.example.com'

const config: FerryConfig = {
  baseUrl: BASE,
  hackClubAuth: { clientId: 'hca', clientSecret: 'hca-secret' },
  hackatime: { mode: 'off' },
  airtable: { apiKey: 'k', baseId: 'appX' },
  fillout: { formUrl: 'https://forms.example.com/x' },
  secret: 'x'.repeat(32),
  session: { secure: false },
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Kick off auth and return the state + the session cookie to replay. */
async function startAuth(ferry: ReturnType<typeof createFerry>) {
  const res = await ferry.handle(new Request(`${BASE}/submit`))
  if (!res) throw new Error('expected a response')
  const location = res.headers.get('location')
  const setCookie = res.headers.get('set-cookie')
  if (!location || !setCookie)
    throw new Error('expected a redirect with a cookie')
  const state = new URL(location).searchParams.get('state')
  if (!state) throw new Error('expected a state param')
  return { res, state, cookie: setCookie.split(';')[0] ?? '' }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mount matching', () => {
  it('returns null for paths outside basePath', async () => {
    const ferry = createFerry(config)
    expect(await ferry.handle(new Request(`${BASE}/somewhere-else`))).toBeNull()
  })

  it('404s unmatched paths under basePath', async () => {
    const ferry = createFerry(config)
    const res = await ferry.handle(new Request(`${BASE}/submit/nope`))
    expect(res?.status).toBe(404)
  })
})

describe('config errors', () => {
  it('500s with the missing fields listed', async () => {
    const ferry = createFerry({ baseUrl: BASE }) // nothing else configured
    const res = await ferry.handle(new Request(`${BASE}/submit`))
    expect(res?.status).toBe(500)
    const body = await res?.text()
    expect(body).toContain('hackClubAuth.clientId')
    expect(body).toContain('secret (FERRY_SECRET)')
  })
})

describe('hack club auth start', () => {
  it('redirects to the authorize endpoint and sets a session cookie', async () => {
    const ferry = createFerry(config)
    const { res, state } = await startAuth(ferry)

    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') as string)
    expect(location.origin + location.pathname).toBe(
      'https://auth.hackclub.com/oauth/authorize'
    )
    expect(location.searchParams.get('client_id')).toBe('hca')
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/submit/hackclub/callback'
    )
    expect(location.searchParams.get('scope')).toContain('basic_info')
    expect(state).toMatch(/^[0-9a-f]+$/)
    expect(res.headers.get('set-cookie')).toContain('ferry_session=')
  })
})

describe('hack club auth callback', () => {
  it('rejects a mismatched state', async () => {
    const ferry = createFerry(config)
    const { cookie } = await startAuth(ferry)
    const res = await ferry.handle(
      new Request(`${BASE}/submit/hackclub/callback?code=abc&state=wrong`, {
        headers: { cookie },
      })
    )
    expect(res?.status).toBe(400)
  })

  it('with hackatime off, upserts and redirects to Fillout with the linking key', async () => {
    const ferry = createFerry(config) // hackatime: off
    const { state, cookie } = await startAuth(ferry)

    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/oauth/token')) {
          return json({ access_token: 'tok', token_type: 'Bearer' })
        }
        if (url.endsWith('/api/v1/me')) {
          return json({
            identity: {
              id: 'u1',
              verification_status: 'verified',
              ysws_eligible: true,
              first_name: 'Ada',
              last_name: 'Lovelace',
              slack_id: 'U123',
              primary_email: 'ada@example.com',
            },
          })
        }
        // Airtable: no existing user, then create.
        if (
          url.includes('api.airtable.com') &&
          (init?.method ?? 'GET') === 'GET'
        ) {
          return json({ records: [] })
        }
        if (url.includes('api.airtable.com') && init?.method === 'POST') {
          return json({ id: 'recNew', fields: {} })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await ferry.handle(
      new Request(`${BASE}/submit/hackclub/callback?code=abc&state=${state}`, {
        headers: { cookie },
      })
    )
    expect(res?.status).toBe(302)
    const loc = new URL(res?.headers.get('location') as string)
    expect(loc.origin + loc.pathname).toBe('https://forms.example.com/x')
    expect(loc.searchParams.get('auth_token')).toMatch(/^[0-9a-f]{32}$/)
    expect(res?.headers.get('set-cookie')).toContain('ferry_session=')
  })

  it('redirects a needs_submission user to HCA verification', async () => {
    const ferry = createFerry(config)
    const { state, cookie } = await startAuth(ferry)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/oauth/token')) {
          return json({ access_token: 'tok', token_type: 'Bearer' })
        }
        return json({
          identity: { id: 'u3', verification_status: 'needs_submission' },
        })
      })
    )

    const res = await ferry.handle(
      new Request(`${BASE}/submit/hackclub/callback?code=abc&state=${state}`, {
        headers: { cookie },
      })
    )
    expect(res?.status).toBe(302)
    expect(res?.headers.get('location')).toBe(
      'https://auth.hackclub.com/verifications/new'
    )
  })

  it('blocks an ineligible user with a 403', async () => {
    const ferry = createFerry(config)
    const { state, cookie } = await startAuth(ferry)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/oauth/token')) {
          return json({ access_token: 'tok', token_type: 'Bearer' })
        }
        return json({
          identity: { id: 'u2', verification_status: 'ineligible' },
        })
      })
    )

    const res = await ferry.handle(
      new Request(`${BASE}/submit/hackclub/callback?code=abc&state=${state}`, {
        headers: { cookie },
      })
    )
    expect(res?.status).toBe(403)
    expect((await res?.text()) ?? '').toContain('not eligible')
  })
})

describe('hackatime flow', () => {
  const htConfig: FerryConfig = {
    ...config,
    hackatime: { mode: 'required', clientId: 'ht', clientSecret: 'ht-secret' },
  }

  /** Mock the Hack Club callback for a brand-new user (no Hackatime token). */
  function hackclubNewUserMock() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('auth.hackclub.com') && url.endsWith('/oauth/token')) {
        return json({ access_token: 'hca-tok', token_type: 'Bearer' })
      }
      if (url.endsWith('/api/v1/me')) {
        return json({
          identity: {
            id: 'u1',
            verification_status: 'verified',
            ysws_eligible: true,
            slack_id: 'U123',
          },
        })
      }
      if (
        url.includes('api.airtable.com') &&
        (init?.method ?? 'GET') === 'GET'
      ) {
        return json({ records: [] })
      }
      if (url.includes('api.airtable.com') && init?.method === 'POST') {
        return json({ id: 'recNew', fields: {} })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  }

  it('redirects a user with no Hackatime token to Hackatime OAuth', async () => {
    const ferry = createFerry(htConfig)
    const { state, cookie } = await startAuth(ferry)
    vi.stubGlobal('fetch', hackclubNewUserMock())

    const res = await ferry.handle(
      new Request(`${BASE}/submit/hackclub/callback?code=abc&state=${state}`, {
        headers: { cookie },
      })
    )
    expect(res?.status).toBe(302)
    const loc = new URL(res?.headers.get('location') as string)
    expect(loc.origin + loc.pathname).toBe(
      'https://hackatime.hackclub.com/oauth/authorize'
    )
    expect(loc.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/submit/hackatime/callback'
    )
    expect(res?.headers.get('set-cookie')).toContain('ferry_session=')
  })

  it('reuses a stored (encrypted) Hackatime token without a re-login', async () => {
    const ferry = createFerry(htConfig)
    const { state, cookie } = await startAuth(ferry)

    // Pre-seal a Hackatime token the way the router stores it.
    const encrypted = await createCipher(
      'x'.repeat(32),
      'ferry/hackatime-token/v1'
    ).seal('stored-tok')

    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url.includes('auth.hackclub.com') && url.endsWith('/oauth/token')) {
          return json({ access_token: 'hca-tok', token_type: 'Bearer' })
        }
        if (url.endsWith('/api/v1/me')) {
          return json({
            identity: {
              id: 'u1',
              verification_status: 'verified',
              slack_id: 'U123',
            },
          })
        }
        // Existing user with a stored, encrypted Hackatime token.
        if (
          url.includes('api.airtable.com') &&
          url.includes('filterByFormula')
        ) {
          return json({
            records: [
              {
                id: 'recExisting',
                fields: { 'Auth Token': 'kept', 'Hackatime Token': encrypted },
              },
            ],
          })
        }
        if (url.includes('/User/recExisting') && method === 'PATCH') {
          return json({
            id: 'recExisting',
            fields: { 'Hackatime Token': encrypted },
          })
        }
        if (url.includes('/User/recExisting') && method === 'GET') {
          return json({ id: 'recExisting', fields: {} })
        }
        // Reuse path: fetch projects with the decrypted token.
        if (
          url.includes('hackatime.hackclub.com/api/v1/authenticated/projects')
        ) {
          return json({ projects: [{ name: 'p', total_seconds: 10 }] })
        }
        if (url.includes('api.airtable.com') && method === 'POST') {
          return json({ records: [{ id: 'recProj', fields: {} }] })
        }
        throw new Error(`unexpected fetch: ${url} (${method})`)
      }
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await ferry.handle(
      new Request(`${BASE}/submit/hackclub/callback?code=abc&state=${state}`, {
        headers: { cookie },
      })
    )
    // No Hackatime OAuth redirect — straight to Fillout.
    expect(res?.status).toBe(302)
    expect(res?.headers.get('location')).toContain('forms.example.com')
    // Never hit the Hackatime token endpoint (no re-login).
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(
      calledUrls.some((u) => u.includes('hackatime.hackclub.com/oauth/token'))
    ).toBe(false)
  })

  it('completes the Hackatime callback: syncs projects and redirects to Fillout', async () => {
    const ferry = createFerry(htConfig)

    // Drive through Hack Club to reach the Hackatime authorize redirect.
    const { state: hcState, cookie: hcCookie } = await startAuth(ferry)
    vi.stubGlobal('fetch', hackclubNewUserMock())
    const toHackatime = await ferry.handle(
      new Request(
        `${BASE}/submit/hackclub/callback?code=abc&state=${hcState}`,
        {
          headers: { cookie: hcCookie },
        }
      )
    )
    const htState = new URL(
      toHackatime?.headers.get('location') as string
    ).searchParams.get('state') as string
    const htCookie =
      (toHackatime?.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    vi.unstubAllGlobals()

    // Now the Hackatime callback.
    const created: unknown[] = []
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (
          url.includes('hackatime.hackclub.com') &&
          url.endsWith('/oauth/token')
        ) {
          return json({ access_token: 'ht-tok', token_type: 'Bearer' })
        }
        if (url.endsWith('/api/v1/authenticated/me')) {
          return json({ id: 42, slack_id: 'U123' })
        }
        if (url.includes('/api/v1/authenticated/projects')) {
          return json({
            projects: [
              { name: 'ferry', total_seconds: 3600, archived: false },
              { name: 'old', total_seconds: 60, archived: true },
            ],
          })
        }
        if (url.includes('/User/recNew') && method === 'PATCH') {
          return json({ id: 'recNew', fields: {} })
        }
        if (url.includes('/User/recNew') && method === 'GET') {
          return json({ id: 'recNew', fields: {} }) // no existing projects
        }
        if (url.includes('api.airtable.com') && method === 'POST') {
          created.push(JSON.parse(init?.body as string))
          return json({ records: [{ id: 'recProj', fields: {} }] })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await ferry.handle(
      new Request(
        `${BASE}/submit/hackatime/callback?code=xyz&state=${htState}`,
        {
          headers: { cookie: htCookie },
        }
      )
    )
    expect(res?.status).toBe(302)
    const loc = new URL(res?.headers.get('location') as string)
    expect(loc.origin + loc.pathname).toBe('https://forms.example.com/x')
    expect(loc.searchParams.get('auth_token')).toMatch(/^[0-9a-f]{32}$/)

    // Only the non-archived project should have been written.
    const body = created[0] as {
      records: { fields: Record<string, unknown> }[]
    }
    expect(body.records).toHaveLength(1)
    expect(body.records[0]?.fields.Name).toBe('ferry')
    expect(body.records[0]?.fields.Time).toBe(3600)
  })
})

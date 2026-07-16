import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFerry, type FerryConfig } from './index'

const BASE = 'https://app.example.com'

const config: FerryConfig = {
  baseUrl: BASE,
  hackClubAuth: { clientId: 'hca', clientSecret: 'hca-secret' },
  hackatime: { mode: 'off' },
  airtable: { apiKey: 'k', baseId: 'appX' },
  fillout: { formUrl: 'https://forms.example.com/x' },
  session: { secret: 'x'.repeat(32), secure: false },
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
    expect(body).toContain('session.secret')
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

  it('exchanges the code, fetches identity, and shows the signed-in page', async () => {
    const ferry = createFerry(config)
    const { state, cookie } = await startAuth(ferry)

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/oauth/token')) {
        return json({
          access_token: 'tok',
          token_type: 'Bearer',
          expires_in: 100,
        })
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
          scopes: ['name', 'basic_info'],
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await ferry.handle(
      new Request(`${BASE}/submit/hackclub/callback?code=abc&state=${state}`, {
        headers: { cookie },
      })
    )
    expect(res?.status).toBe(200)
    const html = (await res?.text()) ?? ''
    expect(html).toContain('Ada Lovelace')
    expect(html).toContain('U123')
    expect(fetchMock).toHaveBeenCalledTimes(2)
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

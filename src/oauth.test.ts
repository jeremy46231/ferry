import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAuthorizeUrl,
  exchangeCode,
  type OAuthEndpoints,
  OAuthError,
  randomState,
} from './oauth'

const endpoints: OAuthEndpoints = {
  authorizeEndpoint: 'https://auth.example.com/oauth/authorize',
  tokenEndpoint: 'https://auth.example.com/oauth/token',
  clientId: 'client-abc',
  clientSecret: 'secret-xyz',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildAuthorizeUrl()', () => {
  it('sets the standard authorization-code params', () => {
    const url = new URL(
      buildAuthorizeUrl(endpoints, {
        redirectUri: 'https://app.example.com/submit/hackclub/callback',
        scopes: ['openid', 'name', 'slack_id'],
        state: 'state-123',
      })
    )
    expect(url.origin + url.pathname).toBe(
      'https://auth.example.com/oauth/authorize'
    )
    expect(url.searchParams.get('client_id')).toBe('client-abc')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/submit/hackclub/callback'
    )
    expect(url.searchParams.get('scope')).toBe('openid name slack_id')
    expect(url.searchParams.get('state')).toBe('state-123')
  })
})

describe('exchangeCode()', () => {
  it('POSTs a urlencoded body and returns the parsed token', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = new URLSearchParams(init.body as string)
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('the-code')
      expect(body.get('client_id')).toBe('client-abc')
      expect(body.get('client_secret')).toBe('secret-xyz')
      expect(body.get('redirect_uri')).toBe('https://app.example.com/cb')
      return new Response(
        JSON.stringify({
          access_token: 'tok',
          token_type: 'Bearer',
          expires_in: 100,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const token = await exchangeCode(endpoints, {
      code: 'the-code',
      redirectUri: 'https://app.example.com/cb',
    })
    expect(token.access_token).toBe('tok')
    expect(token.token_type).toBe('Bearer')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('throws an OAuthError with status/body on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad request', { status: 400 }))
    )
    const err = await exchangeCode(endpoints, {
      code: 'x',
      redirectUri: 'y',
    }).catch((e) => e)
    expect(err).toBeInstanceOf(OAuthError)
    expect((err as OAuthError).status).toBe(400)
    expect((err as OAuthError).body).toContain('bad request')
  })
})

describe('randomState()', () => {
  it('produces a hex string of the expected length and is unique', () => {
    const a = randomState()
    const b = randomState()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
})

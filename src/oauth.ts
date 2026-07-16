/**
 * Minimal OAuth2 authorization-code client, shared by both providers.
 *
 * Neither Hack Club Auth nor Hackatime advertise PKCE
 * (`code_challenge_methods_supported` is null in HCA's discovery doc), so this
 * uses the plain authorization-code grant with the client secret in the token
 * request body (`client_secret_post`) and an opaque `state` for CSRF.
 */

export interface OAuthEndpoints {
  authorizeEndpoint: string
  tokenEndpoint: string
  clientId: string
  clientSecret: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

/** Thrown when a token exchange fails; carries the upstream status/body. */
export class OAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

/** Build the `/oauth/authorize` redirect URL. */
export function buildAuthorizeUrl(
  endpoints: OAuthEndpoints,
  params: { redirectUri: string; scopes: string[]; state: string }
): string {
  const url = new URL(endpoints.authorizeEndpoint)
  url.searchParams.set('client_id', endpoints.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', params.scopes.join(' '))
  url.searchParams.set('state', params.state)
  return url.toString()
}

/** Exchange an authorization code for tokens at `/oauth/token`. */
export async function exchangeCode(
  endpoints: OAuthEndpoints,
  params: { code: string; redirectUri: string }
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: endpoints.clientId,
    client_secret: endpoints.clientSecret,
  })

  const res = await fetch(endpoints.tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new OAuthError(
      `token exchange failed (${res.status} ${res.statusText})`,
      res.status,
      text
    )
  }

  return (await res.json()) as TokenResponse
}

/** Cryptographically-random hex string for the OAuth `state` parameter. */
export function randomState(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes))
  let out = ''
  for (const b of arr) out += b.toString(16).padStart(2, '0')
  return out
}

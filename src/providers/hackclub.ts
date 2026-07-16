import type { ResolvedConfig } from '../config'
import type { OAuthEndpoints } from '../oauth'

/**
 * Hack Club Auth provider: OAuth endpoints, the `/api/v1/me` identity shape,
 * and eligibility interpretation.
 *
 * Docs: https://auth.hackclub.com/docs/oauth-guide, .../docs/api
 */

const AUTHORIZE_ENDPOINT = 'https://auth.hackclub.com/oauth/authorize'
const TOKEN_ENDPOINT = 'https://auth.hackclub.com/oauth/token'
const ME_ENDPOINT = 'https://auth.hackclub.com/api/v1/me'

/** Where to send users whose `verification_status` is `needs_submission`. */
export const HCA_VERIFICATION_URL =
  'https://auth.hackclub.com/verifications/new'

/** Build the OAuth endpoint bundle for the token/authorize client. */
export function hackclubEndpoints(
  clientId: string,
  clientSecret: string
): OAuthEndpoints {
  return {
    authorizeEndpoint: AUTHORIZE_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId,
    clientSecret,
  }
}

export interface HcaAddress {
  id?: string
  first_name?: string
  last_name?: string
  line_1?: string
  line_2?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
  phone_number?: string
  primary?: boolean
}

export type VerificationStatus =
  | 'needs_submission'
  | 'pending'
  | 'verified'
  | 'ineligible'
  | (string & {})

/** Subset of `/api/v1/me` that Ferry consumes. Every field is scope-gated, so
 * treat all as optional except `id`. */
export interface HcaIdentity {
  id: string
  ysws_eligible?: boolean
  verification_status?: VerificationStatus
  first_name?: string
  last_name?: string
  primary_email?: string
  slack_id?: string
  phone_number?: string
  birthday?: string
  addresses?: HcaAddress[]
  /** Scopes actually granted (lives alongside `identity` in the response). */
  scopes?: string[]
}

/** `/api/v1/me` wraps the identity: `{ identity: {...}, scopes: [...] }`. */
interface MeResponse {
  identity: HcaIdentity
  scopes?: string[]
}

/** Fetch the authenticated user's identity from `/api/v1/me`. */
export async function fetchIdentity(accessToken: string): Promise<HcaIdentity> {
  const res = await fetch(ME_ENDPOINT, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hackclub /api/v1/me failed (${res.status}): ${text}`)
  }
  const data = (await res.json()) as MeResponse
  return { ...data.identity, scopes: data.scopes }
}

export type EligibilityResult =
  | { ok: true }
  | { ok: false; status: 'blocked'; reason: string }
  | { ok: false; status: 'needs_verification'; reason: string }

/**
 * Decide whether an identity may proceed to submission.
 *
 * - `ineligible` → blocked.
 * - `needs_submission` → the user must complete identity verification first.
 * - `pending` → blocked for now (verification in progress); may relax later.
 * - `verified` (or unknown status) with `ysws_eligible !== false` → ok.
 */
export function checkEligibility(identity: HcaIdentity): EligibilityResult {
  const status = identity.verification_status

  if (status === 'ineligible' || identity.ysws_eligible === false) {
    return {
      ok: false,
      status: 'blocked',
      reason:
        'Your Hack Club account is not eligible to submit to this program.',
    }
  }

  if (status === 'needs_submission') {
    return {
      ok: false,
      status: 'needs_verification',
      reason:
        'You need to complete Hack Club identity verification before submitting.',
    }
  }

  if (status === 'pending') {
    return {
      ok: false,
      status: 'blocked',
      reason:
        'Your Hack Club identity verification is still pending. Please try again once it is approved.',
    }
  }

  return { ok: true }
}

/** Require the HCA client credentials from config (guaranteed by validateConfig,
 * but narrowed here without a non-null assertion). */
export function requireHackclubEndpoints(
  config: ResolvedConfig
): OAuthEndpoints {
  const { clientId, clientSecret } = config.hackClubAuth
  if (!clientId || !clientSecret) {
    throw new Error('Hack Club Auth client credentials are not configured')
  }
  return hackclubEndpoints(clientId, clientSecret)
}

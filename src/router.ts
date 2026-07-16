import { requireAirtable, upsertUser } from './airtable'
import type { ResolvedConfig } from './config'
import { buildAuthorizeUrl, exchangeCode, randomState } from './oauth'
import { escapeHtml, htmlResponse } from './pages'
import {
  checkEligibility,
  fetchIdentity,
  HCA_VERIFICATION_URL,
  requireHackclubEndpoints,
} from './providers/hackclub'
import type { SessionStore } from './session'

export interface RouterDeps {
  config: ResolvedConfig
  session: SessionStore
}

/** The path prefix without a trailing slash (empty string when mounted at root). */
function prefix(config: ResolvedConfig): string {
  return config.basePath === '/' ? '' : config.basePath
}

/** Absolute base for building OAuth redirect URIs, e.g. `https://x.com/submit`. */
function redirectBase(url: URL, config: ResolvedConfig): string {
  const origin = (config.baseUrl ?? url.origin).replace(/\/+$/, '')
  return origin + prefix(config)
}

/** Route a request already known to live under `basePath`. Always returns a
 * Response (404 for unmatched sub-paths). Never returns null. */
export async function handleFerryRequest(
  request: Request,
  url: URL,
  deps: RouterDeps
): Promise<Response> {
  const bp = prefix(deps.config)
  const path = url.pathname

  if (path === deps.config.basePath || path === `${bp}/`) {
    return startHackclubAuth(url, deps)
  }
  if (path === `${bp}/hackclub/callback`) {
    return hackclubCallback(request, url, deps)
  }
  if (path === `${bp}/hackatime/callback`) {
    // Wired in step 5.
    return htmlResponse(
      501,
      'Not implemented',
      '<p>Hackatime step is not implemented yet.</p>'
    )
  }

  return htmlResponse(404, 'Not found', '<p>Nothing here.</p>')
}

/** Entry point: kick off the Hack Club Auth authorization-code flow. */
async function startHackclubAuth(
  url: URL,
  deps: RouterDeps
): Promise<Response> {
  const { config, session } = deps
  const endpoints = requireHackclubEndpoints(config)
  const state = randomState()
  const redirectUri = `${redirectBase(url, config)}/hackclub/callback`

  const authorizeUrl = buildAuthorizeUrl(endpoints, {
    redirectUri,
    scopes: config.hackClubAuth.scopes,
    state,
  })

  const setCookie = await session.commit({ state, pending: 'hackclub' })
  return new Response(null, {
    status: 302,
    headers: { location: authorizeUrl, 'set-cookie': setCookie },
  })
}

/** Handle the redirect back from Hack Club Auth. */
async function hackclubCallback(
  request: Request,
  url: URL,
  deps: RouterDeps
): Promise<Response> {
  const { config, session } = deps
  const params = url.searchParams

  const authError = params.get('error')
  if (authError) {
    return htmlResponse(
      400,
      'Authorization failed',
      `<h1>Authorization failed</h1><p>Hack Club Auth returned: <code>${escapeHtml(authError)}</code></p>`
    )
  }

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) {
    return htmlResponse(
      400,
      'Bad request',
      '<p>Missing <code>code</code> or <code>state</code>.</p>'
    )
  }

  const sess = await session.read(request)
  const sessionExpired = htmlResponse(
    400,
    'Session expired',
    '<p>Your sign-in session was invalid or expired. Please start again.</p>'
  )
  if (!sess) return sessionExpired
  if (sess.pending !== 'hackclub' || sess.state !== state) return sessionExpired

  const endpoints = requireHackclubEndpoints(config)
  const redirectUri = `${redirectBase(url, config)}/hackclub/callback`
  const token = await exchangeCode(endpoints, { code, redirectUri })
  const identity = await fetchIdentity(token.access_token)

  const eligibility = checkEligibility(identity)
  if (!eligibility.ok) {
    if (eligibility.status === 'needs_verification') {
      // Send the user to Hack Club identity verification; they can re-run /submit
      // afterwards.
      return new Response(null, {
        status: 302,
        headers: { location: HCA_VERIFICATION_URL },
      })
    }
    return htmlResponse(
      403,
      'Not eligible',
      `<h1>Can't submit yet</h1><p>${escapeHtml(eligibility.reason)}</p>`
    )
  }

  if (!identity.slack_id) {
    return htmlResponse(
      400,
      'Slack account required',
      '<h1>Slack account required</h1><p>Your Hack Club account has no linked Slack ID, which this program needs. Please link Slack and try again.</p>'
    )
  }

  // Upsert the User row (keyed on Slack ID). Ferry mints the Auth Token and
  // writes it on creation — no automation, no reread round trip.
  const airtable = requireAirtable(config)
  const { authToken, created } = await upsertUser(airtable, identity)

  // Remember the token for later steps / return visits.
  const setCookie = await session.commit({ authToken })

  // TODO(step 5): Hackatime connect / project sync, then redirect to Fillout.
  const name = [identity.first_name, identity.last_name]
    .filter(Boolean)
    .join(' ')
  return htmlResponse(
    200,
    'Signed in',
    `<h1>Signed in to Hack Club</h1>
<p>Welcome${name ? `, ${escapeHtml(name)}` : ''}.</p>
<p class="muted">Slack ID: <code>${escapeHtml(identity.slack_id)}</code><br>
Email: <code>${escapeHtml(identity.primary_email ?? '—')}</code><br>
Verification: <code>${escapeHtml(identity.verification_status ?? '—')}</code></p>
<p class="muted">Airtable User row ${created ? 'created' : 'updated'}. Hackatime + Fillout steps are not wired yet.</p>`,
    { 'set-cookie': setCookie }
  )
}

import {
  type AirtableConfig,
  getUser,
  hackatimeTokenOf,
  projectIdsOf,
  replaceUserProjects,
  requireAirtable,
  updateUserHackatime,
  upsertUser,
} from './airtable'
import type { ResolvedConfig } from './config'
import { createCipher } from './crypto'
import { buildAuthorizeUrl, exchangeCode, randomState } from './oauth'
import { escapeHtml, htmlResponse } from './pages'
import {
  fetchHackatimeUser,
  fetchProjects,
  requireHackatimeEndpoints,
} from './providers/hackatime'
import {
  checkEligibility,
  fetchIdentity,
  HCA_VERIFICATION_URL,
  requireHackclubEndpoints,
} from './providers/hackclub'
import type { SessionStore } from './session'

export interface RouterDeps {
  config: ResolvedConfig
  /** Master secret, for deriving the at-rest token cipher. */
  secret: string
  session: SessionStore
}

/** Purpose label for encrypting the Hackatime token stored in Airtable. */
const HACKATIME_TOKEN_PURPOSE = 'ferry/hackatime-token/v1'

/** The path prefix without a trailing slash (empty string when mounted at root). */
function prefix(config: ResolvedConfig): string {
  return config.basePath === '/' ? '' : config.basePath
}

/** Absolute base for building OAuth redirect URIs, e.g. `https://x.com/submit`. */
function redirectBase(url: URL, config: ResolvedConfig): string {
  const origin = (config.baseUrl ?? url.origin).replace(/\/+$/, '')
  return origin + prefix(config)
}

function redirect(location: string, setCookie?: string): Response {
  const headers: Record<string, string> = { location }
  if (setCookie) headers['set-cookie'] = setCookie
  return new Response(null, { status: 302, headers })
}

const sessionExpired = () =>
  htmlResponse(
    400,
    'Session expired',
    '<p>Your session was invalid or expired. Please start again.</p>'
  )

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
    return hackatimeCallback(request, url, deps)
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
  return redirect(authorizeUrl, setCookie)
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
  if (!sess) return sessionExpired()
  if (sess.pending !== 'hackclub' || sess.state !== state) {
    return sessionExpired()
  }

  const endpoints = requireHackclubEndpoints(config)
  const redirectUri = `${redirectBase(url, config)}/hackclub/callback`
  const token = await exchangeCode(endpoints, { code, redirectUri })
  const identity = await fetchIdentity(token.access_token)

  const eligibility = checkEligibility(identity)
  if (!eligibility.ok) {
    if (eligibility.status === 'needs_verification') {
      // Send the user to Hack Club identity verification; they can re-run
      // /submit afterwards.
      return redirect(HCA_VERIFICATION_URL)
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
  const { record, authToken } = await upsertUser(airtable, identity)

  return advanceAfterUser(url, deps, {
    recordId: record.id,
    authToken,
    encryptedHackatimeToken: hackatimeTokenOf(record),
  })
}

/** After the user is known in Airtable, decide the Hackatime step and finish. */
async function advanceAfterUser(
  url: URL,
  deps: RouterDeps,
  ctx: {
    recordId: string
    authToken: string
    /** The at-rest (encrypted) Hackatime token from the User row, if any. */
    encryptedHackatimeToken?: string
  }
): Promise<Response> {
  const { config, secret } = deps

  if (config.hackatime.mode === 'off') {
    return finishToFillout(deps, ctx.authToken)
  }

  // If we already have a usable Hackatime token for this user, reuse it
  // silently: decrypt, sync projects, and move on without a re-login.
  if (ctx.encryptedHackatimeToken) {
    const token = await createCipher(secret, HACKATIME_TOKEN_PURPOSE).open(
      ctx.encryptedHackatimeToken
    )
    if (token) {
      try {
        await syncHackatimeProjects(
          requireAirtable(config),
          ctx.recordId,
          token
        )
        return finishToFillout(deps, ctx.authToken)
      } catch {
        // Stored token no longer works — fall through to re-connect.
      }
    }
  }

  return startHackatimeAuth(url, deps, ctx.authToken, ctx.recordId)
}

/** Kick off the Hackatime authorization-code flow (no interstitial). */
async function startHackatimeAuth(
  url: URL,
  deps: RouterDeps,
  authToken: string,
  recordId: string
): Promise<Response> {
  const { config, session } = deps
  const endpoints = requireHackatimeEndpoints(config)
  const state = randomState()
  const redirectUri = `${redirectBase(url, config)}/hackatime/callback`

  const authorizeUrl = buildAuthorizeUrl(endpoints, {
    redirectUri,
    scopes: config.hackatime.scopes,
    state,
  })

  const setCookie = await session.commit({
    state,
    pending: 'hackatime',
    authToken,
    userRecordId: recordId,
  })
  return redirect(authorizeUrl, setCookie)
}

/** Handle the redirect back from Hackatime. */
async function hackatimeCallback(
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
      `<h1>Authorization failed</h1><p>Hackatime returned: <code>${escapeHtml(authError)}</code></p>`
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
  if (!sess) return sessionExpired()
  if (
    sess.pending !== 'hackatime' ||
    sess.state !== state ||
    !sess.authToken ||
    !sess.userRecordId
  ) {
    return sessionExpired()
  }

  const endpoints = requireHackatimeEndpoints(config)
  const redirectUri = `${redirectBase(url, config)}/hackatime/callback`
  const token = await exchangeCode(endpoints, { code, redirectUri })

  const airtable = requireAirtable(config)
  const htUser = await fetchHackatimeUser(token.access_token)

  // Store the token encrypted at rest (the Airtable base is org-readable); use
  // the plaintext token in-memory to sync projects now.
  const encryptedToken = await createCipher(
    deps.secret,
    HACKATIME_TOKEN_PURPOSE
  ).seal(token.access_token)
  await updateUserHackatime(airtable, sess.userRecordId, {
    token: encryptedToken,
    userId: htUser.id,
  })
  await syncHackatimeProjects(airtable, sess.userRecordId, token.access_token)

  return finishToFillout(deps, sess.authToken)
}

/** Fetch the user's non-archived Hackatime projects and overwrite their rows. */
async function syncHackatimeProjects(
  airtable: AirtableConfig,
  recordId: string,
  hackatimeToken: string
): Promise<void> {
  const projects = await fetchProjects(hackatimeToken)
  const user = await getUser(airtable, recordId)
  await replaceUserProjects(
    airtable,
    recordId,
    projectIdsOf(user),
    projects.map((p) => ({ name: p.name, seconds: p.total_seconds }))
  )
}

/** Final step: redirect to Fillout with the hidden linking key. */
async function finishToFillout(
  deps: RouterDeps,
  authToken: string
): Promise<Response> {
  const { config, session } = deps
  const formUrl = config.fillout.formUrl
  if (!formUrl) {
    return htmlResponse(
      500,
      'Misconfigured',
      '<p>No Fillout form configured.</p>'
    )
  }

  const setCookie = await session.commit({ authToken })
  const target = new URL(formUrl)
  target.searchParams.set(config.fillout.linkingKeyParam, authToken)
  return redirect(target.toString(), setCookie)
}

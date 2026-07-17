import type { ResolvedConfig } from '../config'
import type { OAuthEndpoints } from '../lib/oauth'

/**
 * Hackatime provider: OAuth endpoints, the authenticated user's id, and coding
 * project data.
 *
 * Docs: https://hackatime.hackclub.com/docs/oauth/oauth-apps
 */

const AUTHORIZE_ENDPOINT = 'https://hackatime.hackclub.com/oauth/authorize'
const TOKEN_ENDPOINT = 'https://hackatime.hackclub.com/oauth/token'
const ME_ENDPOINT = 'https://hackatime.hackclub.com/api/v1/authenticated/me'
const PROJECTS_ENDPOINT =
  'https://hackatime.hackclub.com/api/v1/authenticated/projects'

export function hackatimeEndpoints(
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

/** `/api/v1/authenticated/me` — we only need the numeric id. */
export interface HackatimeUser {
  id: number
  slack_id?: string
  emails?: string[]
  github_username?: string
}

/** One entry from `/api/v1/authenticated/projects`. */
export interface HackatimeProject {
  name: string
  total_seconds: number
  most_recent_heartbeat?: string
  languages?: string[]
  archived?: boolean
}

interface ProjectsResponse {
  projects: HackatimeProject[]
}

async function get<T>(endpoint: string, accessToken: string): Promise<T> {
  const res = await fetch(endpoint, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hackatime ${endpoint} failed (${res.status}): ${text}`)
  }
  return (await res.json()) as T
}

/** Fetch the authenticated Hackatime user (for the numeric id). */
export function fetchHackatimeUser(
  accessToken: string
): Promise<HackatimeUser> {
  return get<HackatimeUser>(ME_ENDPOINT, accessToken)
}

export interface FetchProjectsOptions {
  /** Include archived projects (default false). */
  includeArchived?: boolean
  /** Event start date (`YYYY-MM-DD`). Crops each project's counted time to
   * on/after this date (`start`) and limits discovery to projects active since
   * then (`since`). */
  startDate?: string
}

/**
 * Fetch the user's projects. Archived projects are excluded by default. When
 * `startDate` is given, time is counted only on/after that date and projects
 * with no activity in range are dropped.
 */
export async function fetchProjects(
  accessToken: string,
  opts: FetchProjectsOptions = {}
): Promise<HackatimeProject[]> {
  const params = new URLSearchParams()
  if (opts.includeArchived) params.set('include_archived', 'true')
  if (opts.startDate) {
    // `since` scopes which projects are discovered; `start` crops total_seconds.
    params.set('since', opts.startDate)
    params.set('start', opts.startDate)
  }
  const qs = params.toString()
  const url = qs ? `${PROJECTS_ENDPOINT}?${qs}` : PROJECTS_ENDPOINT

  const data = await get<ProjectsResponse>(url, accessToken)
  let projects = data.projects ?? []
  if (!opts.includeArchived) projects = projects.filter((p) => !p.archived)
  // With a start date, drop projects that have no time in the window.
  if (opts.startDate) projects = projects.filter((p) => p.total_seconds > 0)
  return projects
}

/** Require Hackatime client credentials from config. */
export function requireHackatimeEndpoints(
  config: ResolvedConfig
): OAuthEndpoints {
  const { clientId, clientSecret } = config.hackatime
  if (!clientId || !clientSecret) {
    throw new Error('Hackatime client credentials are not configured')
  }
  return hackatimeEndpoints(clientId, clientSecret)
}

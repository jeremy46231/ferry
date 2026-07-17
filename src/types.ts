/**
 * User-supplied configuration for {@link createFerry}.
 *
 * Every field is optional here: values are resolved from environment variables
 * first, then these overrides win. Anything still missing is reported as a
 * clear error `Response` at request time — never a boot-time crash.
 *
 * See `DESIGN.md` for the full picture.
 */
export interface FerryConfig {
  /** Public origin Ferry is served from, e.g. `https://ysws.example.com`.
   * Env: `FERRY_BASE_URL`. Falls back to the incoming request's origin. */
  baseUrl?: string
  /** Path prefix Ferry is mounted at. Env: `FERRY_BASE_PATH`. Default `/submit`. */
  basePath?: string

  /** Explicit environment bag to read `FERRY_*` values from, consulted before
   * `globalThis.process.env`. Supply this on runtimes without `process`
   * (Cloudflare Workers, other edges) — e.g. `createFerry({ env })`. Values are
   * `unknown` so a Cloudflare `Env` (mixing string vars with bindings) can be
   * passed as-is; only string entries are read. */
  env?: Record<string, unknown>

  /** Master secret (>= 32 chars) used to derive all encryption keys — the
   * session cookie and the at-rest Hackatime token. Env: `FERRY_SECRET`.
   * Generate with `openssl rand -hex 32`. */
  secret?: string

  /** Event start date (`YYYY-MM-DD`). When set, Hackatime project data only
   * counts time on/after this date, and only projects with activity since then
   * are included. Env: `FERRY_EVENT_START_DATE`. */
  eventStartDate?: string

  hackClubAuth?: {
    /** Env: `FERRY_HCA_CLIENT_ID`. */
    clientId?: string
    /** Env: `FERRY_HCA_CLIENT_SECRET`. */
    clientSecret?: string
    /** OAuth scopes to request. `basic_info` covers the Slack ID (dedup key),
     * so no explicit `slack_id` scope is needed. */
    scopes?: string[]
  }

  hackatime?: {
    /** Whether the Hackatime step is enforced. Env: `FERRY_HACKATIME_MODE`. */
    mode?: 'required' | 'off'
    /** Env: `FERRY_HACKATIME_CLIENT_ID` (the app "UID"). */
    clientId?: string
    /** Env: `FERRY_HACKATIME_CLIENT_SECRET`. */
    clientSecret?: string
    /** OAuth scopes to request. Default `['profile', 'read']`. */
    scopes?: string[]
  }

  airtable?: {
    /** Personal access token / API key. Env: `FERRY_AIRTABLE_API_KEY`. */
    apiKey?: string
    /** Base id, e.g. `appXXXXXXXXXXXXXX`. Env: `FERRY_AIRTABLE_BASE_ID`. */
    baseId?: string
    /** Override the default table names if your base renamed them. */
    tables?: {
      users?: string
      hackatimeProjects?: string
      submissions?: string
      config?: string
    }
  }

  fillout?: {
    /** The Fillout/Airtable form URL to redirect submitters to.
     * Env: `FERRY_FILLOUT_FORM_URL`. */
    formUrl?: string
    /** Hidden form field name that carries the User row's `auth_token`.
     * Default `auth_token`. */
    linkingKeyParam?: string
  }

  session?: {
    /** Cookie name. Default `ferry_session`. */
    cookieName?: string
    /** Session lifetime in seconds. Default 3600. */
    ttlSeconds?: number
    /** Emit the `Secure` cookie attribute. Default `true`. */
    secure?: boolean
  }
}

/** The minimal state Ferry keeps in the encrypted session cookie.
 * Raw OAuth access tokens are NOT stored here — they live in Airtable. */
export interface SessionData {
  /** OAuth `state` for the in-flight authorization, if any. */
  state?: string
  /** Which provider the in-flight authorization is for. */
  pending?: 'hca' | 'hackatime'
  /** The Airtable `User` row's `auth_token`, once known. */
  authToken?: string
  /** The Airtable `User` record id, once the row is upserted. */
  userRecordId?: string
  /** Expiry (epoch seconds); set on commit, checked on read. */
  exp?: number
}

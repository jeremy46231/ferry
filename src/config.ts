import type { FerryConfig } from './types'

/**
 * Read an environment variable without ever throwing.
 *
 * Checks the explicit `bag` first (e.g. a Cloudflare Workers `env`), then falls
 * back to `process.env`. On runtimes without a `process` global and no bag, it
 * simply returns `undefined` — those hosts pass config explicitly to
 * {@link createFerry}.
 */
export function env(
  key: string,
  bag?: Record<string, unknown>
): string | undefined {
  const fromBag = bag?.[key]
  if (typeof fromBag === 'string' && fromBag.length > 0) return fromBag
  try {
    const p = (globalThis as { process?: { env?: Record<string, unknown> } })
      .process
    const v = p?.env?.[key]
    if (typeof v === 'string' && v.length > 0) return v
  } catch {
    // ignore — degrade to undefined
  }
  return undefined
}

/** Fully-resolved config: defaults applied, but required values may still be
 * absent (validated separately at request time). */
export interface ResolvedConfig {
  baseUrl?: string
  basePath: string
  secret?: string
  eventStartDate?: string
  hackClubAuth: {
    clientId?: string
    clientSecret?: string
    scopes: string[]
  }
  hackatime: {
    mode: 'required' | 'off'
    clientId?: string
    clientSecret?: string
    scopes: string[]
  }
  airtable: {
    apiKey?: string
    baseId?: string
    tables: {
      users: string
      hackatimeProjects: string
      submissions: string
      config: string
    }
  }
  fillout: {
    formUrl?: string
    linkingKeyParam: string
  }
  session: {
    cookieName: string
    ttlSeconds: number
    secure: boolean
  }
}

// The scopes a YSWS app is granted. `basic_info` is the HQ-gated bundle that
// carries email, name, verification status, birthday, phone — and, confirmed in
// practice, the Slack ID (our dedup key) + ysws_eligible. `name`/`birthdate`/
// `address` add those identity fields. We deliberately DON'T request the generic
// OIDC scopes `openid`/`profile`/`email`: apps must be permitted for each scope
// they request or the authorize step fails, and those aren't granted to YSWS
// apps (nor needed — `basic_info` already covers the data).
const DEFAULT_HCA_SCOPES = [
  'basic_info',
  'name',
  'verification_status',
  'birthdate',
  'address',
]

const DEFAULT_HACKATIME_SCOPES = ['profile', 'read']

/** Normalize a scope value that may arrive as an array or a space/comma string. */
function toScopes(
  override: string[] | undefined,
  envValue: string | undefined,
  fallback: string[]
): string[] {
  if (override && override.length > 0) return override
  if (envValue) {
    const parts = envValue.split(/[\s,]+/).filter(Boolean)
    if (parts.length > 0) return parts
  }
  return fallback
}

function normalizeBasePath(input: string | undefined): string {
  let p = (input ?? '/submit').trim()
  if (!p.startsWith('/')) p = `/${p}`
  // strip trailing slashes (but keep root as "/")
  p = p.replace(/\/+$/, '')
  return p === '' ? '/' : p
}

/**
 * Merge environment variables with explicit overrides into a resolved config.
 * Explicit values win over env. Never throws.
 */
export function resolveConfig(input: FerryConfig = {}): ResolvedConfig {
  const read = (key: string) => env(key, input.env)

  const hackatimeMode: 'required' | 'off' =
    input.hackatime?.mode ??
    (read('FERRY_HACKATIME_MODE') === 'off' ? 'off' : 'required')

  return {
    baseUrl: input.baseUrl ?? read('FERRY_BASE_URL'),
    basePath: normalizeBasePath(input.basePath ?? read('FERRY_BASE_PATH')),
    secret: input.secret ?? read('FERRY_SECRET'),
    eventStartDate: input.eventStartDate ?? read('FERRY_EVENT_START_DATE'),

    hackClubAuth: {
      clientId: input.hackClubAuth?.clientId ?? read('FERRY_HCA_CLIENT_ID'),
      clientSecret:
        input.hackClubAuth?.clientSecret ?? read('FERRY_HCA_CLIENT_SECRET'),
      scopes: toScopes(
        input.hackClubAuth?.scopes,
        read('FERRY_HCA_SCOPES'),
        DEFAULT_HCA_SCOPES
      ),
    },

    hackatime: {
      mode: hackatimeMode,
      clientId: input.hackatime?.clientId ?? read('FERRY_HACKATIME_CLIENT_ID'),
      clientSecret:
        input.hackatime?.clientSecret ?? read('FERRY_HACKATIME_CLIENT_SECRET'),
      scopes: toScopes(
        input.hackatime?.scopes,
        read('FERRY_HACKATIME_SCOPES'),
        DEFAULT_HACKATIME_SCOPES
      ),
    },

    airtable: {
      apiKey: input.airtable?.apiKey ?? read('FERRY_AIRTABLE_API_KEY'),
      baseId: input.airtable?.baseId ?? read('FERRY_AIRTABLE_BASE_ID'),
      tables: {
        users: input.airtable?.tables?.users ?? 'User',
        hackatimeProjects:
          input.airtable?.tables?.hackatimeProjects ?? 'Hackatime Projects',
        submissions:
          input.airtable?.tables?.submissions ?? 'YSWS Project Submission',
        config: input.airtable?.tables?.config ?? 'YSWS Config',
      },
    },

    fillout: {
      formUrl: input.fillout?.formUrl ?? read('FERRY_FILLOUT_FORM_URL'),
      linkingKeyParam: input.fillout?.linkingKeyParam ?? 'auth_token',
    },

    session: {
      cookieName: input.session?.cookieName ?? 'ferry_session',
      ttlSeconds: input.session?.ttlSeconds ?? 3600,
      secure: input.session?.secure ?? true,
    },
  }
}

/**
 * Return a list of human-readable problems with a resolved config. An empty
 * array means the config is usable. Used to produce a clear error `Response`
 * rather than crashing.
 */
export function validateConfig(cfg: ResolvedConfig): string[] {
  const missing: string[] = []

  if (!cfg.hackClubAuth.clientId)
    missing.push('hackClubAuth.clientId (FERRY_HCA_CLIENT_ID)')
  if (!cfg.hackClubAuth.clientSecret)
    missing.push('hackClubAuth.clientSecret (FERRY_HCA_CLIENT_SECRET)')

  if (cfg.hackatime.mode !== 'off') {
    if (!cfg.hackatime.clientId)
      missing.push('hackatime.clientId (FERRY_HACKATIME_CLIENT_ID)')
    if (!cfg.hackatime.clientSecret)
      missing.push('hackatime.clientSecret (FERRY_HACKATIME_CLIENT_SECRET)')
  }

  if (!cfg.airtable.apiKey)
    missing.push('airtable.apiKey (FERRY_AIRTABLE_API_KEY)')
  if (!cfg.airtable.baseId)
    missing.push('airtable.baseId (FERRY_AIRTABLE_BASE_ID)')

  if (!cfg.fillout.formUrl)
    missing.push('fillout.formUrl (FERRY_FILLOUT_FORM_URL)')

  if (!cfg.secret) {
    missing.push('secret (FERRY_SECRET)')
  } else if (cfg.secret.length < 32) {
    missing.push('secret must be at least 32 characters')
  }

  if (cfg.eventStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(cfg.eventStartDate)) {
    missing.push('eventStartDate must be YYYY-MM-DD (FERRY_EVENT_START_DATE)')
  }

  return missing
}

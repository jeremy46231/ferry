import { type ResolvedConfig, resolveConfig, validateConfig } from './config'
import { createSessionStore, type SessionStore } from './session'
import type { FerryConfig } from './types'

export type { ResolvedConfig } from './config'
export type { FerryConfig, SessionData } from './types'

export interface Ferry {
  /** The fully-resolved configuration (env + overrides). */
  readonly config: ResolvedConfig
  /**
   * Handle a request. Returns a `Response` for routes Ferry owns (under
   * `basePath`), or `null` when the path is not Ferry's — respond `404`.
   *
   * Never throws: internal failures produce an error `Response` and a
   * `console.error` on the server.
   */
  handle(request: Request): Promise<Response | null>
}

function textResponse(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

/** Does `pathname` fall under `basePath` (the prefix itself or a child)? */
function isUnderBasePath(pathname: string, basePath: string): boolean {
  if (basePath === '/') return true
  return pathname === basePath || pathname.startsWith(`${basePath}/`)
}

/**
 * Create a Ferry instance for a single YSWS program.
 *
 * Config is read from the environment and merged with any explicit overrides
 * passed here. Missing required config is reported as an error `Response` at
 * request time rather than throwing on construction.
 */
export function createFerry(options: FerryConfig = {}): Ferry {
  const config = resolveConfig(options)

  // Built lazily once the secret is known to be present (see handle()).
  let sessionStore: SessionStore | null = null
  function getSessionStore(secret: string): SessionStore {
    if (!sessionStore) {
      sessionStore = createSessionStore({
        secret,
        cookieName: config.session.cookieName,
        path: config.basePath,
        ttlSeconds: config.session.ttlSeconds,
        secure: config.session.secure,
      })
    }
    return sessionStore
  }

  return {
    config,

    async handle(request: Request): Promise<Response | null> {
      try {
        const url = new URL(request.url)
        if (!isUnderBasePath(url.pathname, config.basePath)) return null

        const problems = validateConfig(config)
        if (problems.length > 0) {
          const detail = problems.map((p) => `  - ${p}`).join('\n')
          console.error(`[ferry] misconfigured:\n${detail}`)
          return textResponse(
            500,
            `Ferry is misconfigured. Missing/invalid:\n${detail}`
          )
        }

        // Secret is guaranteed present by validateConfig above; re-checked here
        // to satisfy the type checker (belt-and-suspenders).
        const secret = config.session.secret
        if (!secret) return textResponse(500, 'Ferry is misconfigured.')
        const session = getSessionStore(secret)
        void session // wired for the router landing in step 3

        // TODO(step 3+): OAuth + Airtable + Fillout state machine.
        return textResponse(
          501,
          'Ferry route handler not yet implemented (scaffold).'
        )
      } catch (err) {
        console.error('[ferry] unhandled error in handle():', err)
        return textResponse(500, 'Ferry encountered an internal error.')
      }
    },
  }
}

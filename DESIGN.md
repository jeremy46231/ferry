# Design

> [!WARNING]
> this document came out of a claude opus design chat

Ferry is a framework-agnostic, server-side TypeScript library that automates the
Hack Club YSWS submission flow. A YSWS author mounts it at `/submit/*`, feeds it
`Request`s, and returns the `Response`s it hands back (or `404`s when it returns
`null`). Ferry owns the whole journey: Hack Club Auth → (Hackatime) → Airtable →
Fillout.

It is a self-hostable alternative to `submit.hackclub.com`: same identity-verify +
prefill-redirect job, plus it does the Hackatime OAuth + project sync into Airtable
for you, and it's a library you run rather than a hosted service.

## Contract

```ts
import { createFerry } from 'ferry'

const ferry = createFerry(config) // config optional; see below

// in any server route mounted at /submit/*
const res = await ferry.handle(request) // Response | null
// null  -> route not ours -> respond 404
```

`handle(Request): Promise<Response | null>` is the entire public surface.
Web Fetch `Request`/`Response` in, `Response | null` out — no framework coupling.
`handle()` **never throws**: internal failures become an error `Response` (with a
clear message in the body) and a `console.error` on the server.

## Runtime & packaging

- **Web-standard APIs only.** `fetch`, `URL`, `TextEncoder`, `crypto.subtle`. No
  `node:*` imports. Same build runs on Node 18+, Bun, Deno, Cloudflare Workers,
  and Vercel/Netlify edge.
- **Zero runtime dependencies.** Encrypted cookie is hand-rolled on Web Crypto;
  Airtable is called via its REST API through `fetch` (not the Node-only
  `airtable` SDK).
- **Dual-published** ESM + CJS with a clean `exports` map, shipped `.d.ts`,
  `"type": "module"`, `"sideEffects": false`, `engines` set.

## Toolchain (dev only — does not affect where the lib runs)

- Package manager / runner: **bun**
- Build: **tsdown** (Rolldown/Oxc) → dual ESM+CJS + types
- Tests: **vitest**
- Format: **Prettier** (existing `.prettierrc`); strict `tsc` for typecheck
- No linter yet (add later if the gap is felt)

## Configuration

One Ferry instance serves **one** YSWS program. Config is read from **env with
object overrides**, and env reading is defensive — it can never crash (guarded
`typeof process`/`import.meta` access wrapped in try/catch), degrading to
`undefined` on runtimes without `process.env`.

```ts
interface FerryConfig {
  baseUrl?: string // FERRY_BASE_URL; else derived from request origin
  basePath?: string // default "/submit"

  hackClubAuth: {
    clientId: string // FERRY_HCA_CLIENT_ID
    clientSecret: string // FERRY_HCA_CLIENT_SECRET
    scopes?: string[] // default: name, verification_status, basic_info (provides Slack ID), address, ...
  }

  hackatime: {
    mode: 'required' | 'off' // FERRY_HACKATIME_MODE
    clientId: string // FERRY_HACKATIME_CLIENT_ID (UID)
    clientSecret: string // FERRY_HACKATIME_CLIENT_SECRET
    scopes?: string[] // default ["profile", "read"]
  }

  airtable: {
    apiKey: string // FERRY_AIRTABLE_API_KEY
    baseId: string // FERRY_AIRTABLE_BASE_ID
    // table names default to the known schema; overridable
  }

  fillout: {
    formUrl: string // FERRY_FILLOUT_FORM_URL
    linkingKeyParam?: string // hidden field carrying the User auth_token
  }

  session: {
    secret: string // FERRY_SESSION_SECRET (>= 32 bytes)
    cookieName?: string // default "ferry_session"
    ttlSeconds?: number
  }
}
```

Explicit override values win over env. Missing-but-required config surfaces as a
clear error `Response` at request time (never a boot crash).

## Routes / state machine

All under `basePath` (default `/submit`). Callback paths match the registered
OAuth apps.

| Route                            | Behavior                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /submit`                    | Entry. No/expired session → start HCA. Else advance to next incomplete step. Returning users are recognized and re-run silently. |
| `GET /submit/hackclub/callback`  | HCA `code`→token, fetch `/api/v1/me`, enforce eligibility (below), upsert `User` row, read back `auth_token`. Decide Hackatime.  |
| `GET /submit/hackatime/callback` | Hackatime `code`→token, store `hackatime_token` + `hackatime_user_id`, sync projects.                                            |
| (internal) redirect to Fillout   | Build Fillout URL with the hidden linking key (`auth_token`), `302`.                                                             |

Unmatched paths under `basePath` → error/404; paths outside `basePath` →
`null`.

### Hackatime step

- Author config decides `required` vs `off`. **No user-facing skip button.**
- On return from HCA, if the `User` row already has a usable `hackatime_token`
  (from a prior run), **reuse it silently** — fetch projects, skip the login.
- Otherwise, if `mode: "required"`, **auto-redirect straight to Hackatime OAuth**
  (no interstitial page). If `off`, skip the step entirely.

### Eligibility gating (enforced)

Using HCA `verification_status` / `ysws_eligible`:

- `needs_submission` → redirect the user into HCA identity verification.
- `ineligible` → stop with a clear error page.
- `verified` (and eligible) → proceed. `pending` handling: treat as blocked with
  an explanatory page (revisit if too strict).

### Return visits

Recognized via cookie / Slack ID → re-sync identity + Hackatime, update the `User`
row, redirect to Fillout again. Supports resubmission / updates.

## Session cookie

- **AES-GCM encrypted** (Web Crypto), keyed from `session.secret`.
- Minimal contents: OAuth `state`, which provider is `pending`, and the user's
  `auth_token` once known. **Raw OAuth tokens live only in Airtable, never in the
  cookie.**
- `HttpOnly; Secure; SameSite=Lax; Path=<basePath>`.

## OAuth

Plain OAuth2 authorization-code for both providers — **no PKCE** (HCA's discovery
doc reports `code_challenge_methods_supported: null` and neither provider
documents it). CSRF is covered by an opaque `state` verified against the encrypted
cookie. The client secret is sent in the token request body (`client_secret_post`).
The HCA access token is used once (to call `/api/v1/me`) and then discarded — only
Hackatime tokens are persisted (in Airtable) for reuse.

**Hack Club Auth** (`auth.hackclub.com`)

- `GET /oauth/authorize` → `POST /oauth/token` → `GET /api/v1/me` (Bearer).
- Scopes: community-level `openid profile email name verification_status` plus
  HQ-gated `birthdate address basic_info` as granted to our app. The Slack ID is
  our dedup key (no Slack ID → no Airtable row); `basic_info` provides it
  (confirmed in practice), so **no explicit `slack_id` scope is needed**.
- `/api/v1/me` fields used: `id`, `ysws_eligible`, `verification_status`,
  `first_name`, `last_name`, `primary_email`, `slack_id`, `birthday`,
  `addresses[]` (line_1/2, city, state, postal_code, country).

**Hackatime** (`hackatime.hackclub.com`)

- `GET /oauth/authorize` → `POST /oauth/token` (grant `authorization_code`) →
  `GET /api/v1/authenticated/projects`.
- Scopes `profile read`. Access tokens are effectively long-lived → stored and
  reused.
- Per project used: `name`, total seconds, archived (filter out archived).

## Airtable mapping (base schema)

Talk to Airtable via REST (`fetch`). Tables (names overridable):

- **User** — one row per submitter, **deduped by Slack ID**. Written by Ferry:
  `Slack ID`, `First Name`, `Last Name`, `Email`, `Birthday`, address parts,
  `Hackatime User ID`, `Hackatime Token`. `Auth Token` is minted by an existing
  Airtable automation on row creation; Ferry reads it back and uses it as the
  Fillout linking key + cookie user reference.
- **Hackatime Projects** — `Name`, `Time` (duration = total seconds), `User`
  (link). Snapshot at submit: all non-archived projects; re-sync overwrites.
- **YSWS Project Submission** — **not written by Ferry.** Fillout writes it; Ferry
  only seeds the `User` link via the hidden `auth_token`.
- **YSWS Config** — key/value; read e.g. `YSWS Program (Airtable ID)`.

## Fillout redirect

Final step `302`s to `fillout.formUrl` with the hidden linking key
(`linkingKeyParam` = the `User` row's `auth_token`) so the eventual submission
links back to the right `User`. **Only the linking key** is passed — no identity
prefill mapping to maintain.

## Repo layout

```
ferry/                 # the npm package (this repo)
  src/
    index.ts           # createFerry
    router.ts          # the state machine (only stateful logic)
    session.ts         # encrypted cookie (Web Crypto)
    oauth.ts           # generic OAuth2 + PKCE client
    providers/
      hackclub-auth.ts # /api/v1/me, eligibility
      hackatime.ts     # /authenticated/projects
    airtable.ts        # REST client: upsert user, sync projects, config read
    config.ts          # safe env reading + override merge
    pages.ts           # minimal built-in HTML (errors, verification prompts)
  package.json         # bun, tsdown build, ESM+CJS exports, types
  tsconfig.json
playground/            # gitignored — Vite + a server mounting ferry at /submit/*
```

## Build order

1. Scaffold package (bun, tsdown, strict TS, dual exports) + `handle()` contract
   and Request/Response plumbing.
2. Safe config loader + encrypted session cookie.
3. Generic OAuth2+PKCE client → HCA provider → `/me` → eligibility → upsert `User`.
   (End-to-end auth works.)
4. Airtable REST client (upsert user, read back `auth_token`, config read).
5. Hackatime provider → project sync → token-reuse (skip-login) path.
6. Fillout redirect with hidden linking key.
7. `playground/` harness to click through the full flow against the dev creds.

## Open items

- Confirm exact HCA `authorize`/`token` params + PKCE method (S256) against the
  OAuth guide before wiring provider #1.
- `pending` verification handling — blocked vs. allowed (currently blocked).
- `baseUrl` behind proxies — prefer explicit `FERRY_BASE_URL`; request-origin
  fallback for local/dev.

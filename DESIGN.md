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
- Format + lint: **Biome** (recommended rules); strict `tsc` for typecheck

## Configuration

One Ferry instance serves **one** YSWS program. Config is read from **env with
object overrides**, and env reading is defensive — it can never crash (guarded
`globalThis.process` access wrapped in try/catch), degrading to `undefined` on
runtimes without `process.env` (edge/workers pass config explicitly).

```ts
interface FerryConfig {
  baseUrl?: string // FERRY_BASE_URL; else derived from request origin
  basePath?: string // default "/submit"
  secret?: string // FERRY_SECRET (>= 32 chars); master key for all encryption
  eventStartDate?: string // FERRY_EVENT_START_DATE (YYYY-MM-DD), optional

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
    tables?: {...} // default to the known schema; overridable
  }

  fillout: {
    formUrl: string // FERRY_FILLOUT_FORM_URL
    linkingKeyParam?: string // hidden field carrying the User auth_token; default "auth_token"
  }

  session: {
    cookieName?: string // default "ferry_session"
    ttlSeconds?: number // default 3600
    secure?: boolean // default true; set false for http://localhost
  }
}
```

`eventStartDate`, when set, scopes all Hackatime project data to on/after that
date (see [Hackatime step](#hackatime-step)).

Explicit override values win over env. Missing-but-required config surfaces as a
clear error `Response` at request time (never a boot crash).

## Routes / state machine

All under `basePath` (default `/submit`). Callback paths match the registered
OAuth apps.

| Route                            | Behavior                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /submit`                    | Entry. No/expired session → start HCA. Else advance to next incomplete step. Returning users are recognized and re-run silently. |
| `GET /submit/hackclub/callback`  | HCA `code`→token, fetch `/api/v1/me`, enforce eligibility (below), upsert `User` row (Ferry mints `Auth Token`). Decide Hackatime. |
| `GET /submit/hackatime/callback` | Hackatime `code`→token, store encrypted `Hackatime Token` + `Hackatime User ID`, sync projects.                                   |
| (internal) redirect to Fillout   | Build Fillout URL with the hidden linking key (`auth_token`), `302`.                                                             |

Unmatched paths under `basePath` → error/404; paths outside `basePath` →
`null`.

### Hackatime step

- Author config decides `required` vs `off`. **No user-facing skip button.**
- On return from HCA, if the `User` row already has a usable `Hackatime Token`
  (from a prior run), **decrypt and reuse it silently** — fetch projects, skip the
  login. If the stored token fails, fall back to re-connecting.
- Otherwise, if `mode: "required"`, **auto-redirect straight to Hackatime OAuth**
  (no interstitial page). If `off`, skip the step entirely.
- **Date scoping:** when `eventStartDate` is set, project fetches pass `since`
  (limits which projects are discovered) and `start` (crops each project's counted
  `total_seconds`) to that date, and projects with no time in the window are
  dropped. Without it, all non-archived projects and their all-time totals sync.

### Eligibility gating (enforced)

Using HCA `verification_status` / `ysws_eligible`:

- `needs_submission` → redirect the user into HCA identity verification.
- `ineligible` → stop with a clear error page.
- `verified` (and eligible) → proceed. `pending` handling: treat as blocked with
  an explanatory page (revisit if too strict).

### Return visits

Recognized via cookie / Slack ID → re-sync identity + Hackatime, update the `User`
row, redirect to Fillout again. Supports resubmission / updates.

## Security / crypto

One master secret (`FERRY_SECRET`) is stretched into purpose-separated AES-GCM
keys via **HKDF-SHA256** (`crypto.ts` → `createCipher(secret, purpose)`), so the
cookie key and the DB-token key are never the same key. HKDF assumes a
high-entropy secret (`openssl rand -hex 32`); it is not a passphrase stretcher.

**Session cookie** (purpose `ferry/session/v1`):

- AES-GCM encrypted. Minimal contents: OAuth `state`, which provider is
  `pending`, the user's `auth_token`, and the Airtable `userRecordId` once known.
  **Raw OAuth tokens never touch the cookie.**
- `HttpOnly; Secure; SameSite=Lax; Path=<basePath>` (`Secure` off only when
  `session.secure: false`, for `http://localhost`).

**Hackatime token at rest** (purpose `ferry/hackatime-token/v1`):

- The stored Hackatime token is a long-lived bearer credential, and Airtable
  bases are readable org-wide — so it is **encrypted at rest**. Only Ferry can
  decrypt it to reuse; a decrypt failure falls back to re-OAuth. The
  `Hackatime User ID` and synced project rows stay plaintext (reviewers need
  them).

**`auth_token`** stays a random opaque token. It is inherently plaintext in
Airtable (Fillout writes it into the submission and Airtable matches on it), so
linking trust is bounded by who can write to the base — crypto can't fix that.
Rotating `FERRY_SECRET` invalidates existing cookies and stored token ciphertext;
both degrade gracefully (users restart the flow / re-OAuth).

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
  `GET /api/v1/authenticated/me` (numeric `id`) + `GET /api/v1/authenticated/projects`.
- Scopes `profile read`. Access tokens are effectively long-lived → stored
  (encrypted) and reused.
- Per project used: `name`, `total_seconds`, `archived` (archived filtered out).
  `since`/`start` params applied when `eventStartDate` is set.

## Airtable mapping (base schema)

Talk to Airtable via REST (`fetch`). Tables (names overridable):

- **User** — one row per submitter, **deduped by Slack ID**. Written by Ferry:
  `Slack ID`, `First Name`, `Last Name`, `Email`, `Birthday`, address parts,
  `Hackatime User ID`, encrypted `Hackatime Token`, and `Auth Token`. Ferry
  **mints the `Auth Token`** and writes it on creation (no automation, no
  create-then-reread round trip); it's the Fillout linking key. Returning users
  keep their existing token.
- **Hackatime Projects** — `Name`, `Time` (duration = total seconds), `User`
  (link). Snapshot at submit: existing rows for the user are deleted and
  recreated (overwrite). Time is cropped to `eventStartDate` when set.
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
    index.ts           # createFerry -> { handle, middleware, config }
    router.ts          # the state machine (only stateful logic)
    config.ts          # safe env reading (+ explicit env bag) + merge + validation
    crypto.ts          # HKDF subkeys + AES-GCM createCipher(secret, purpose)
    session.ts         # encrypted session cookie (uses crypto.ts)
    random.ts          # randomHex / randomToken
    oauth.ts           # generic OAuth2 authorization-code client (no PKCE)
    pages.ts           # minimal built-in HTML + text responses
    node.ts            # Connect (req,res,next) adapter -> ferry.middleware()
    airtable.ts        # REST client: upsert user, sync projects
    providers/
      hackclub.ts      # /api/v1/me, eligibility
      hackatime.ts     # /authenticated/me + /authenticated/projects
    types.ts           # FerryConfig, SessionData
  package.json         # bun, tsdown build, ESM+CJS exports, types
  biome.json, tsconfig.json, tsconfig.test.json, tsdown.config.ts
sandbox/               # one integration harness per host, all on :5173 (creds
  vite/                #   gitignored). vite uses ferry.middleware(); web-native
  sveltekit/           #   hosts call ferry.handle() directly (SvelteKit hook,
  nextjs/              #   Next catch-all route, Worker fetch). Each imports the
  workers/             #   library's src/ directly (bun run sandbox:setup).
```

## Host integration

`handle(Request): Promise<Response | null>` is the core; web-native hosts call it
directly. Node servers use `ferry.middleware()`, a Connect `(req, res, next)`
adapter. Runtimes without `process.env` (Workers) pass config via an env bag:
`createFerry({ env })`, consulted before `process.env`. The `sandbox/` dir has a
minimal working example for each.

## Status

Steps 1–6 are implemented and tested (unit + integration with mocked `fetch`);
the full flow runs end to end: **HCA → eligibility → Airtable upsert → Hackatime
(reuse-or-connect) → project sync → Fillout**. Session cookie and the at-rest
Hackatime token are encrypted from one HKDF-derived master secret. The
`sandbox/` harnesses (Vite, SvelteKit, Next.js, Cloudflare Workers) drive it
against the dev creds.

## Open items

- **Live-verify** the Hackatime `since`/`start` date scoping (the OpenAPI spec
  documents them, but it hasn't been exercised against a real token yet).
- `pending` verification handling — blocked vs. allowed (currently blocked).
- `baseUrl` behind proxies — prefer explicit `FERRY_BASE_URL`; request-origin
  fallback for local/dev.

# Ferry

Framework-agnostic library that automates the Hack Club YSWS submission flow.
Mount it at `/submit/*` on any server-side route, feed it `Request`s, return the
`Response`s it hands back. It handles Hack Club Auth, Hackatime, Airtable, and the
Fillout hand-off.

See [`DESIGN.md`](./DESIGN.md) for the architecture and decisions.

> **Status:** the full flow works end to end — **Hack Club Auth → eligibility →
> Airtable upsert → Hackatime (reuse-or-connect) → project sync → Fillout**. Not
> published to npm yet. See [`DESIGN.md`](./DESIGN.md) § Open items.

## Usage

```ts
import { createFerry } from 'ferry'

const ferry = createFerry() // reads FERRY_* env; pass overrides to createFerry({...})

// in any server route mounted at /submit/*
const res = await ferry.handle(request)
if (res) return res
// null -> not a Ferry route -> respond 404
```

`handle(request)` never throws: misconfiguration and internal errors come back as
an error `Response` (and a `console.error`), and non-Ferry paths return `null`.
It depends only on Web-standard APIs (`fetch`, `crypto.subtle`, …), so the same
build runs on Node 18+, Bun, Deno, Cloudflare Workers, and edge.

## Configuration

Config comes from `FERRY_*` environment variables, overridable via
`createFerry({ ... })`. See [`.env.example`](./.env.example) for the full list;
the essentials:

| Variable                                            | Notes                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `FERRY_SECRET`                                      | Master secret, ≥32 chars (`openssl rand -hex 32`). Derives all encryption keys. |
| `FERRY_BASE_URL`                                    | Public origin, for building OAuth redirect URIs.                                |
| `FERRY_HCA_CLIENT_ID` / `_SECRET`                   | Hack Club Auth OAuth app.                                                       |
| `FERRY_HACKATIME_MODE`                              | `required` or `off`.                                                            |
| `FERRY_HACKATIME_CLIENT_ID` / `_SECRET`             | Hackatime OAuth app (when not `off`).                                           |
| `FERRY_AIRTABLE_API_KEY` / `FERRY_AIRTABLE_BASE_ID` | Airtable token + base.                                                          |
| `FERRY_FILLOUT_FORM_URL`                            | Where submitters are sent to finish.                                            |
| `FERRY_EVENT_START_DATE`                            | Optional `YYYY-MM-DD`; scopes Hackatime time to on/after this date.             |

Register your OAuth callbacks at `<FERRY_BASE_URL><basePath>/hackclub/callback`
and `.../hackatime/callback` (default `basePath` is `/submit`).

## Development

```sh
bun install
bun run test        # vitest
bun run typecheck   # tsc (library + tests)
bun run build       # tsdown -> dist/ (ESM + CJS + types)
bun run format      # biome (write)
bun run check       # biome lint + format + import sorting (check only)
bun run check:fix   # biome, with autofixes applied
```

Integration sandboxes live in `sandbox/` — one per host (`vite`, `sveltekit`,
`nextjs`, `workers`), each mounting Ferry at `/submit` on port 5173. They install
Ferry from a packed tarball: run `bun run pack:sandbox` (build + pack
`ferry.tgz`) at the repo root, then `bun install` in a sandbox. See each
sandbox's `README.md`.

Wiring Ferry into a host is a line or two:

| Host                          | Integration                                                            |
| ----------------------------- | ---------------------------------------------------------------------- |
| Node (Vite/Express/Connect)   | `server.middlewares.use(ferry.middleware())`                           |
| SvelteKit (`hooks.server.ts`) | `(await ferry.handle(event.request)) ?? resolve(event)`                |
| Next.js (catch-all route)     | `(await ferry.handle(request)) ?? new Response(null, { status: 404 })` |
| Cloudflare Workers (`fetch`)  | `(await ferry.handle(request)) ?? env.ASSETS.fetch(request)`           |

Web-native hosts call `handle(request)` directly; Node servers use the
`middleware()` adapter. Runtimes without `process.env` (Workers) pass the env
bag: `createFerry({ env })`.

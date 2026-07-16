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

| Variable | Notes |
| --- | --- |
| `FERRY_SECRET` | Master secret, ≥32 chars (`openssl rand -hex 32`). Derives all encryption keys. |
| `FERRY_BASE_URL` | Public origin, for building OAuth redirect URIs. |
| `FERRY_HCA_CLIENT_ID` / `_SECRET` | Hack Club Auth OAuth app. |
| `FERRY_HACKATIME_MODE` | `required` or `off`. |
| `FERRY_HACKATIME_CLIENT_ID` / `_SECRET` | Hackatime OAuth app (when not `off`). |
| `FERRY_AIRTABLE_API_KEY` / `FERRY_AIRTABLE_BASE_ID` | Airtable token + base. |
| `FERRY_FILLOUT_FORM_URL` | Where submitters are sent to finish. |
| `FERRY_EVENT_START_DATE` | Optional `YYYY-MM-DD`; scopes Hackatime time to on/after this date. |

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

There's a manual test harness in `playground/` (gitignored) — a Vite dev server
that mounts Ferry at `/submit`. See `playground/README.md`.

# Ferry

Framework-agnostic library that automates the Hack Club YSWS submission flow.
Mount it at `/submit/*` on any server-side route, feed it `Request`s, return the
`Response`s it hands back. It handles Hack Club Auth, Hackatime, Airtable, and the
Fillout hand-off.

See [`DESIGN.md`](./DESIGN.md) for the architecture and decisions.

> **Status:** early scaffold. Config loading + encrypted session cookie are in
> place; the OAuth/Airtable/Fillout state machine is not implemented yet.

## Usage (target API)

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

## Development

```sh
bun install
bun run test        # vitest
bun run typecheck   # tsc (library + tests)
bun run build       # tsdown -> dist/ (ESM + CJS + types)
bun run format      # biome (write)
bun run check       # biome format + import sorting (check only)
```

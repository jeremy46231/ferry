# ferry-sandbox-workers

Minimal Cloudflare Workers integration for [Ferry](../..), served with Wrangler's
static assets binding.

## Integration

The entire integration is `src/index.ts`:

```ts
import { createFerry } from 'ferry'

export interface Env {
  ASSETS: Fetcher
  [key: string]: unknown // FERRY_* vars from .dev.vars
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const ferry = createFerry({ env, session: { secure: false } })
    return (await ferry.handle(request)) ?? env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
```

`wrangler.jsonc` serves `public/` as static assets under the `ASSETS` binding,
but routes `/submit/*` to the Worker first (`assets.run_worker_first`) so Ferry
gets a chance to handle it before falling back to the static file server.

## Running

From the repo root (sets up every sandbox — build + pack ferry, copy `.env`,
install — then start this one):

```sh
bun run sandbox:setup    # once; also refreshes after library changes
bun run sandbox:workers  # http://localhost:5173
```

Or from this directory: `bun run setup` (copies the root `.env` here as
`.dev.vars` and installs), then `bun run dev`.

Then open http://localhost:5173. Secrets (`FERRY_*`) live in `.dev.vars`,
which Wrangler loads automatically in dev — Workers have no `process.env`, so
they're passed explicitly via `createFerry({ env })`.

## Updating Ferry

This project installs Ferry from a packed tarball (`"ferry":
"file:../../ferry.tgz"`). `bun run sandbox:setup` at the repo root re-packs and
re-installs it (bun caches the tarball, so `setup` uses `--force` to re-extract).

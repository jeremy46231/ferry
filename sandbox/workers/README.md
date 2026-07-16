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

```sh
(cd ../.. && bun run pack:sandbox)   # build + pack ferry.tgz (first time / after lib changes)
bun install                          # installs wrangler + ferry (from ../../ferry.tgz)
bun run dev                          # http://localhost:5173
```

Then open http://localhost:5173. Secrets (`FERRY_*`) live in `.dev.vars`,
which Wrangler loads automatically in dev — Workers have no `process.env`, so
they're passed explicitly via `createFerry({ env })`.

## Updating Ferry

This project installs Ferry from a packed tarball (`"ferry":
"file:../../ferry.tgz"`). After changing Ferry's source, re-pack and reinstall:

```sh
(cd ../.. && bun run pack:sandbox)
bun install
```

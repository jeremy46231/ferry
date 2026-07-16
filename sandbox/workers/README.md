# ferry-sandbox-workers

Minimal Cloudflare Workers integration for [Ferry](../..), served with Wrangler's
static assets binding.

## Integration

The entire integration is `src/index.ts` (imports the local source; a real app
would `import { createFerry } from 'ferry'`):

```ts
import { createFerry } from '../../../src/index'

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

From the repo root (copies the root `.env` into every sandbox and installs):

```sh
bun run sandbox:setup    # once (or after adding a dependency)
bun run sandbox:workers  # http://localhost:5173
```

Or from this directory: `bun run setup` (copies the root `.env` here as
`.dev.vars` and installs), then `bun run dev`.

Then open http://localhost:5173. Secrets (`FERRY_*`) live in `.dev.vars`,
which Wrangler loads automatically in dev — Workers have no `process.env`, so
they're passed explicitly via `createFerry({ env })`.

## Consuming Ferry

This sandbox imports Ferry's TypeScript source directly (`../../../src/index`),
which Wrangler bundles with esbuild — so library edits are picked up on the next
`wrangler dev` rebuild, no build or publish step. (In a real app you'd
`npm i ferry` and `import { createFerry } from 'ferry'`.)

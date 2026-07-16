# Ferry · Next.js sandbox

A clean Next.js (App Router) integration test for [Ferry](../..), Hack Club's
framework-agnostic YSWS submission library.

## The integration

The entire integration is one route handler,
`app/submit/[[...path]]/route.ts`, using an *optional* catch-all so it
matches `/submit` itself as well as nested paths like
`/submit/hackclub/callback`:

```ts
import { createFerry } from 'ferry'

const ferry = createFerry({ session: { secure: false } })

async function handler(request: Request) {
  return (await ferry.handle(request)) ?? new Response('Not found', { status: 404 })
}

export { handler as GET }
export const dynamic = 'force-dynamic'
```

`ferry.handle(request)` returns a `Response` for anything under `/submit`, or
`null` if the path isn't Ferry's — in which case we fall back to a 404.
`session.secure: false` is passed explicitly so the session cookie works over
plain `http://localhost`. Ferry reads the rest of its config (`FERRY_*`) from
`process.env`, which Next.js populates automatically from `.env.local`.

## Running it

From the repo root (symlinks the root `.env` into every sandbox and installs):

```bash
bun run sandbox:setup    # once (or after adding a dependency)
bun run sandbox:nextjs   # http://localhost:5173
```

Or from this directory: `bun run setup` (symlinks the root `.env` here as
`.env.local` and installs), then `bun run dev`.

The `dev` script runs `next dev -p 5173 --webpack`, forced onto port 5173 (all
Ferry sandboxes share that port and run one at a time) and onto webpack instead
of Turbopack, which resolves the source dependency more predictably.
`next.config.ts`'s `outputFileTracingRoot` silences the workspace-root warning
from having a lockfile above this directory.

## Consuming Ferry

This sandbox imports Ferry's TypeScript source directly, so library edits
hot-reload — no build or publish step. `tsconfig.json` aliases `ferry` →
`../../src/index.ts` (so the route reads `import … from 'ferry'` like a real
app) and `next.config.ts` sets `experimental.externalDir` to compile source
from outside this directory.

`.env.local` comes from the repo-root `.env` (copied by `setup`) and is
gitignored.

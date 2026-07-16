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

```bash
(cd ../.. && bun run pack:sandbox)   # build + pack ferry.tgz (first time / after lib changes)
bun install                          # installs Next + ferry (from ../../ferry.tgz)
bun run dev                          # http://localhost:5173
```

Then open http://localhost:5173. The `dev` script runs
`next dev -p 5173 --webpack`, forced onto port 5173 (all Ferry sandboxes
share that port and run one at a time) and onto webpack instead of Turbopack,
which keeps resolution of the local `file:` tarball dependency hassle-free.
`next.config.ts`'s `outputFileTracingRoot` silences the workspace-root warning
from having a lockfile above this directory.

## Consuming Ferry

This sandbox installs Ferry from a packed tarball (`"ferry":
"file:../../ferry.tgz"`) — the actual published artifact, built from the repo
root's `dist/`. If you change Ferry's source, re-run `bun run pack:sandbox` at
the repo root, `bun install` here, and restart `bun run dev`.

`.env.local` is a copy of the shared sandbox dev credentials
(`sandbox/vite/.env`) and is gitignored.

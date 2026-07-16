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

From the repo root (sets up every sandbox — build + pack ferry, copy `.env`,
install — then start this one):

```bash
bun run sandbox:setup    # once; also refreshes after library changes
bun run sandbox:nextjs   # http://localhost:5173
```

Or from this directory: `bun run setup` (copies the root `.env` here as
`.env.local` and installs), then `bun run dev`.

The `dev` script runs `next dev -p 5173 --webpack`, forced onto port 5173 (all
Ferry sandboxes share that port and run one at a time) and onto webpack instead
of Turbopack, which keeps resolution of the local `file:` tarball dependency
hassle-free. `next.config.ts`'s `outputFileTracingRoot` silences the
workspace-root warning from having a lockfile above this directory.

## Consuming Ferry

This sandbox installs Ferry from a packed tarball (`"ferry":
"file:../../ferry.tgz"`) — the actual published artifact, built from the repo
root's `dist/`. `bun run sandbox:setup` at the repo root re-packs and
re-installs it after library changes.

`.env.local` comes from the repo-root `.env` (copied by `setup`) and is
gitignored.

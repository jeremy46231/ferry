# Ferry · Vite sandbox

A bare Vite dev server that mounts Ferry at `/submit` for manual testing.

Integration is one line in `vite.config.ts`:

```ts
server.middlewares.use(ferry.middleware())
```

## Run

From the repo root (copies the root `.env` into every sandbox and installs):

```sh
bun run sandbox:setup    # once (or after adding a dependency)
bun run sandbox:vite     # http://localhost:5173
```

Or from this directory: `bun run setup` (copies the root `.env` here as `.env`
and installs), then `bun run dev`.

Open <http://localhost:5173>, click **Start submission**, and you'll go through
Hack Club Auth → Hackatime → Fillout. Creds come from the repo-root `.env`
(gitignored).

> This sandbox imports Ferry's TypeScript source directly (`../../src/index`),
> so library edits are picked up on restart — no build or publish step. (In a
> real app you'd `npm i ferry` and `import { createFerry } from 'ferry'`.)

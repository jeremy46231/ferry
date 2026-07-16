# Ferry · Vite sandbox

A bare Vite dev server that mounts Ferry at `/submit` for manual testing.

Integration is one line in `vite.config.ts`:

```ts
server.middlewares.use(ferry.middleware())
```

## Run

From the repo root (sets up every sandbox — build + pack ferry, copy `.env`,
install — then start this one):

```sh
bun run sandbox:setup    # once; also refreshes after library changes
bun run sandbox:vite     # http://localhost:5173
```

Or from this directory: `bun run setup` (copies the root `.env` here as `.env`
and installs), then `bun run dev`.

Open <http://localhost:5173>, click **Start submission**, and you'll go through
Hack Club Auth → Hackatime → Fillout. Creds come from the repo-root `.env`
(gitignored); Ferry installs from the packed tarball, which `setup` re-extracts
after library changes.

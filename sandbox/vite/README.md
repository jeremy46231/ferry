# Ferry · Vite sandbox

A bare Vite dev server that mounts Ferry at `/submit` for manual testing.

Integration is one line in `vite.config.ts`:

```ts
server.middlewares.use(ferry.middleware())
```

## Run

```sh
(cd ../.. && bun run pack:sandbox)   # build + pack ferry.tgz (first time / after lib changes)
bun install                          # installs vite + ferry (from ../../ferry.tgz)
bun run dev                          # http://localhost:5173
```

> Ferry is installed from a packed tarball (`file:../../ferry.tgz`). After
> changing library source, re-run `bun run pack:sandbox` at the repo root and
> `bun install --force` here (bun caches the tarball, so `--force` re-extracts
> it), then restart.

Open <http://localhost:5173>, click **Start submission**, and you'll go through
Hack Club Auth → Hackatime → Fillout. Creds live in `.env` (gitignored).

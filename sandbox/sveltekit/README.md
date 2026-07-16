# Ferry · SvelteKit sandbox

A minimal SvelteKit app that mounts Ferry at `/submit` for manual testing.

Integration is one server hook, `src/hooks.server.ts`:

```ts
import { createFerry } from 'ferry'
import type { Handle } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'

// SvelteKit doesn't populate process.env from .env in dev, so FERRY_* vars
// are passed explicitly via $env/dynamic/private.
// secure:false so the session cookie works over http://localhost.
const ferry = createFerry({ env, session: { secure: false } })

export const handle: Handle = async ({ event, resolve }) => {
	return (await ferry.handle(event.request)) ?? resolve(event)
}
```

## Run

```sh
(cd ../.. && bun run pack:sandbox)   # build + pack ferry.tgz (first time / after lib changes)
bun install                          # installs SvelteKit + ferry (from ../../ferry.tgz)
bun run dev                          # http://localhost:5173
```

> Ferry is installed from a packed tarball (`file:../../ferry.tgz`). After
> changing library source, re-run `bun run pack:sandbox` at the repo root and
> `bun install` here, then restart.

Open <http://localhost:5173>, click **Start submission →**, and you'll go
through Hack Club Auth → Hackatime → Fillout. Creds live in `.env` (gitignored).

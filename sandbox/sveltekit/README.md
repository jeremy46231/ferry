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

From the repo root (symlinks the root `.env` into every sandbox and installs):

```sh
bun run sandbox:setup      # once (or after adding a dependency)
bun run sandbox:sveltekit  # http://localhost:5173
```

Or from this directory: `bun run setup` (symlinks the root `.env` here as `.env`
and installs), then `bun run dev`.

Open <http://localhost:5173>, click **Start submission →**, and you'll go
through Hack Club Auth → Hackatime → Fillout. Creds come from the repo-root
`.env` (gitignored).

> This sandbox imports Ferry's TypeScript source directly (the hook uses
> `../../../src/index`), so library edits hot-reload — no build or publish step.
> (In a real app you'd `npm i ferry` and `import { createFerry } from 'ferry'`,
> as shown above.)

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

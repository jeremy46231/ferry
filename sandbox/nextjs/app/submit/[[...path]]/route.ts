import { createFerry } from 'ferry'

const ferry = createFerry({ session: { secure: false } })

async function handler(request: Request) {
  return (await ferry.handle(request)) ?? new Response('Not found', { status: 404 })
}

export { handler as GET }
export const dynamic = 'force-dynamic'

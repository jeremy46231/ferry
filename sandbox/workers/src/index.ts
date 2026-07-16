import { createFerry } from 'ferry'

export interface Env {
  ASSETS: Fetcher
  [key: string]: unknown // FERRY_* vars from .dev.vars
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const ferry = createFerry({ env, session: { secure: false } })
    return (await ferry.handle(request)) ?? env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

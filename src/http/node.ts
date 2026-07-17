/**
 * Node/Connect adapter. Bridges Ferry's Web `handle(Request)` to the
 * `(req, res, next)` middleware shape that Vite, Express, Connect, and the raw
 * `node:http` server all speak.
 *
 * The req/res are typed structurally so this file needs no `@types/node` — any
 * object with these members works (`IncomingMessage`/`ServerResponse` do).
 */

/** The subset of a Node `IncomingMessage` this adapter reads. */
export interface NodeRequestLike {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
}

/** The subset of a Node `ServerResponse` this adapter writes. */
export interface NodeResponseLike {
  statusCode: number
  setHeader(name: string, value: string | number | readonly string[]): void
  end(chunk?: string): void
}

/** Connect-style middleware: handles the request, or calls `next()` to pass. */
export type ConnectMiddleware = (
  req: NodeRequestLike,
  res: NodeResponseLike,
  next?: (err?: unknown) => void
) => void

/** Build a Web `Request` from a Node request (GET-only flow — no body). */
function nodeToRequest(req: NodeRequestLike, fallbackHost: string): Request {
  const host = req.headers.host ?? fallbackHost
  const proto = req.headers['x-forwarded-proto']
  const scheme = (Array.isArray(proto) ? proto[0] : proto) ?? 'http'
  const url = `${scheme}://${host}${req.url ?? '/'}`

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v)
    else if (value != null) headers.set(key, value)
  }
  return new Request(url, { method: req.method ?? 'GET', headers })
}

/** Write a Web `Response` onto a Node response (preserving multiple cookies). */
async function sendResponse(
  res: NodeResponseLike,
  response: Response
): Promise<void> {
  res.statusCode = response.status
  const setCookies = response.headers.getSetCookie?.() ?? []
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value)
  })
  if (setCookies.length > 0) res.setHeader('set-cookie', setCookies)
  res.end(await response.text())
}

/**
 * Wrap a `handle(Request)` function as Connect middleware. When `handle`
 * returns `null` (not a Ferry route), the request falls through to `next()`;
 * without a `next` (e.g. as a raw `http` server handler) it 404s.
 */
export function toNodeMiddleware(
  handle: (request: Request) => Promise<Response | null>,
  options: { fallbackHost?: string } = {}
): ConnectMiddleware {
  const fallbackHost = options.fallbackHost ?? 'localhost'
  return (req, res, next) => {
    const pass =
      next ??
      (() => {
        res.statusCode = 404
        res.end('Not found')
      })
    void (async () => {
      try {
        const response = await handle(nodeToRequest(req, fallbackHost))
        if (!response) return pass()
        await sendResponse(res, response)
      } catch (err) {
        if (next) next(err)
        else {
          res.statusCode = 500
          res.end('Internal error')
        }
      }
    })()
  }
}

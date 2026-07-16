/**
 * Minimal built-in HTML responses. Deliberately bare — hosts can front Ferry
 * with their own UI later. Everything user-derived is escaped.
 */

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; }
  code { background: #f2f2f2; padding: 0 .25em; border-radius: 3px; }
  .muted { color: #666; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`
}

export function htmlResponse(
  status: number,
  title: string,
  bodyHtml: string
): Response {
  return new Response(page(title, bodyHtml), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

/** Plain-text response (used for config/internal errors). */
export function textResponse(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

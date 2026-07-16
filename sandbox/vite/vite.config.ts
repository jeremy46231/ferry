import { createFerry } from '../../src/index'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // secure:false so the session cookie works over http://localhost.
  const ferry = createFerry({
    env: loadEnv(mode, process.cwd(), 'FERRY_'),
    session: { secure: false }
  })

  return {
    server: { port: 5173, strictPort: true },
    plugins: [
      {
        name: 'ferry',
        configureServer(server) {
          // ferry.middleware() is a standard (req, res, next) handler:
          // it handles /submit/* and calls next() for everything else.
          server.middlewares.use(ferry.middleware())
        },
      },
    ],
  }
})

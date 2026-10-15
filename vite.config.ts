import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { POST as geocode } from './api/geocode'
import { POST as geocodeFallback } from './api/geocode-fallback'

// Serves /api/geocode during `npm run dev`, the same way Vercel serves it in production.
function localApi(): Plugin {
  const routes: Record<string, (r: Request) => Promise<Response>> = {
    '/api/geocode': geocode,
    '/api/geocode-fallback': geocodeFallback,
  }
  return {
    name: 'local-api',
    configureServer(server) {
      for (const [path, handler] of Object.entries(routes)) {
        server.middlewares.use(path, async (req, res) => {
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const response = await handler(new Request(`http://localhost${path}`, { method: req.method, body: Buffer.concat(chunks) }))
          res.statusCode = response.status
          res.setHeader('content-type', 'application/json')
          res.end(await response.text())
        })
      }
    },
  }
}

export default defineConfig({ plugins: [react(), localApi()] })

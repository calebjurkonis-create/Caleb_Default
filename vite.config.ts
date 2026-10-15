import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { POST as geocode } from './api/geocode'

// Serves /api/geocode during `npm run dev`, the same way Vercel serves it in production.
function localApi(): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api/geocode', async (req, res) => {
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const response = await geocode(
          new Request('http://localhost/api/geocode', { method: req.method, body: Buffer.concat(chunks) }),
        )
        res.statusCode = response.status
        res.setHeader('content-type', 'application/json')
        res.end(await response.text())
      })
    },
  }
}

export default defineConfig({ plugins: [react(), localApi()] })

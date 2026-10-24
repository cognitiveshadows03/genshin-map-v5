import { createReadStream, existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dist = resolve(root, 'dist')

if (!existsSync(resolve(dist, 'index.html'))) {
  console.log('[offline] Production bundle not found; building from local sources…')
  const result = spawnSync(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0)
    process.exit(result.status ?? 1)
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pack': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

const server = createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.writeHead(405).end('Method Not Allowed')
    return
  }

  try {
    const url = new URL(request.url ?? '/', 'http://offline.local')
    const pathname = decodeURIComponent(url.pathname)
    let file = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (file !== dist && !file.startsWith(`${dist}${sep}`)) {
      response.writeHead(403).end('Forbidden')
      return
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      if ((request.headers.accept ?? '').includes('text/html')) {
        file = resolve(dist, 'index.html')
      }
      else {
        response.writeHead(404).end('Not Found')
        return
      }
    }

    const { size } = statSync(file)
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(file)] ?? 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    if (request.method === 'HEAD')
      response.end()
    else
      createReadStream(file).pipe(response)
  }
  catch (error) {
    response.writeHead(500).end(error instanceof Error ? error.message : String(error))
  }
})

const port = Number(process.env.PORT || 13101)
server.listen(port, '0.0.0.0', () => {
  console.log(`[offline] Genshin map: http://localhost:${port}`)
  console.log('[offline] All runtime resources are served from dist/. No Internet connection is required.')
})

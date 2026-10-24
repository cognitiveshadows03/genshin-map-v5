'use strict'

const { app, BrowserWindow, Menu, dialog, session } = require('electron')
const { createReadStream, existsSync, statSync } = require('node:fs')
const { createServer } = require('node:http')
const { extname, join, normalize, resolve, sep } = require('node:path')

const DIST = normalize(join(__dirname, '..', 'dist'))
const HOST = '127.0.0.1'
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.pack': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

let server
let origin = ''
let mainWindow

// electron-builder's portable launcher sets this to the original exe folder.
// Keeping userData there makes completion and preferences portable as well.
if (process.env.PORTABLE_EXECUTABLE_DIR)
  app.setPath('userData', join(process.env.PORTABLE_EXECUTABLE_DIR, 'GenshinMapData'))

const serveBundledApp = async () => {
  if (!existsSync(join(DIST, 'index.html')))
    throw new Error(`Bundled renderer not found: ${DIST}`)

  server = createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end('Method Not Allowed')
      return
    }

    try {
      const url = new URL(request.url ?? '/', 'http://offline.local')
      const pathname = decodeURIComponent(url.pathname)
      let file = resolve(DIST, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (file !== DIST && !file.startsWith(`${DIST}${sep}`)) {
        response.writeHead(403)
        response.end('Forbidden')
        return
      }
      if (!existsSync(file) || !statSync(file).isFile()) {
        if ((request.headers.accept ?? '').includes('text/html'))
          file = join(DIST, 'index.html')
        else {
          response.writeHead(404)
          response.end('Not Found')
          return
        }
      }

      const { size } = statSync(file)
      response.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Content-Length': size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      })
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      const stream = createReadStream(file)
      stream.on('error', error => response.destroy(error))
      stream.pipe(response)
    }
    catch {
      response.writeHead(400)
      response.end('Bad Request')
    }
  })

  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, HOST, resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Unable to start the local offline server')
  origin = `http://${HOST}:${address.port}`
}

const createMainWindow = async () => {
  const localSession = session.defaultSession
  localSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  localSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    // Only the random loopback origin serving the bundled app is permitted.
    callback({ cancel: !details.url.startsWith(`${origin}/`) && details.url !== origin })
  })

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#17202b',
    title: 'Genshin Offline Map',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${origin}/`) && url !== origin)
      event.preventDefault()
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = undefined
  })
  await mainWindow.loadURL(origin)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}
else {
  app.on('second-instance', () => {
    if (!mainWindow)
      return
    if (mainWindow.isMinimized())
      mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    await serveBundledApp()
    await createMainWindow()
  }).catch((error) => {
    dialog.showErrorBox('Genshin Offline Map', error instanceof Error ? error.message : String(error))
    app.quit()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => server?.close())
}

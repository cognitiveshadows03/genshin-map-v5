#!/usr/bin/env node
/** Build output must exist. Run `npm run verify:offline` to build and test. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifacts = resolve(root, 'artifacts')
const port = Number(process.env.OFFLINE_TEST_PORT || 13139)
const baseUrl = `http://127.0.0.1:${port}`
const report = { success: false, static: {}, browser: {} }
let browser
let server

const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

const verifyPack = async (name, expectedFormat) => {
  const index = await readJson(`public/offline/${name}-index.json`)
  const bytes = await readFile(resolve(root, `public/offline/${name}.pack`))
  assert.equal(index.format, expectedFormat)
  assert.equal(index.version, 1)
  assert.equal(index.byteLength, bytes.byteLength)
  assert.equal(index.sha256, sha256(bytes))
  for (const [entryName, [offset, length]] of Object.entries(index.entries)) {
    assert(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && length > 0, `${name}: invalid entry ${entryName}`)
    assert(offset >= 0 && offset + length <= bytes.byteLength, `${name}: out-of-bounds entry ${entryName}`)
    assert.equal(bytes.toString('ascii', offset, offset + 4), 'RIFF', `${name}: invalid RIFF signature ${entryName}`)
    assert.equal(bytes.toString('ascii', offset + 8, offset + 12), 'WEBP', `${name}: invalid WebP signature ${entryName}`)
  }
  return { entries: Object.keys(index.entries).length, bytes: bytes.byteLength, sha256: index.sha256, index }
}

const walk = async (directory) => {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory())
      files.push(...await walk(path))
    else
      files.push(path)
  }
  return files
}

try {
  // ---------- Static bundle verification ----------
  const [tiles, icons, source, labels, chineseLabels, points] = await Promise.all([
    verifyPack('tiles', 'genshin-offline-tile-pack'),
    verifyPack('icons', 'genshin-offline-icon-pack'),
    readJson('public/offline/source.json'),
    readJson('public/offline/labels-en.json'),
    readJson('public/offline/labels.json'),
    readJson('public/offline/points.json'),
  ])
  const surfacePoints = points.filter(point => !point.z)
  const allLabels = []
  const flattenLabels = (nodes) => {
    for (const node of nodes) {
      allLabels.push(node)
      flattenLabels(node.children ?? [])
    }
  }
  flattenLabels(labels)
  const collectLabelIds = (nodes, ids = []) => {
    for (const node of nodes) {
      ids.push(node.id)
      collectLabelIds(node.children ?? [], ids)
    }
    return ids
  }
  assert.deepEqual(
    collectLabelIds(chineseLabels).sort((a, b) => a - b),
    allLabels.map(label => label.id).sort((a, b) => a - b),
    'English and Chinese label IDs do not match',
  )
  assert.equal(source.defaultLanguage, 'en')
  const labelMap = new Map(allLabels.map(label => [label.id, label]))
  const surfaceLabelIds = new Set(surfacePoints.map(point => point.labelId))
  const usedCategoryCount = labels.filter(category => (category.children ?? []).some(label => surfaceLabelIds.has(label.id))).length
  const testIconTag = `official-${surfacePoints[0].labelId}`
  for (const point of surfacePoints) {
    const label = labelMap.get(point.labelId)
    assert(label, `Point ${point.id} references missing label ${point.labelId}`)
    assert(icons.index.entries[label.icon], `Label ${label.id} references missing icon ${label.icon}`)
  }
  assert.equal(source.tileCount, tiles.entries)
  assert.equal(source.iconCount, icons.entries)
  assert.equal(source.surfaceMarkerCount, surfacePoints.length)
  assert.equal(source.excludedFloorMarkerCount, points.length - surfacePoints.length)

  const externalUrls = []
  for (const file of await walk(resolve(root, 'src'))) {
    if (!['.ts', '.tsx', '.js', '.vue', '.css', '.scss'].includes(extname(file)))
      continue
    const text = await readFile(file, 'utf8')
    for (const match of text.matchAll(/https?:\/\/[^\s'"<>)]+/g)) {
      if (!match[0].startsWith('http://www.w3.org/') && !match[0].startsWith('https://www.w3.org/'))
        externalUrls.push(`${file}:${match[0]}`)
    }
  }
  assert.deepEqual(externalUrls, [], 'Runtime source contains non-namespace external URLs')
  const html = await readFile(resolve(root, 'dist/index.html'), 'utf8')
  assert(html.includes('default-src \'self\''), 'Production CSP is missing')
  assert(!existsSync(resolve(root, 'dist/serviceWorker.js')), 'Unexpected service-worker dependency')
  Object.assign(report.static, {
    tiles: { entries: tiles.entries, bytes: tiles.bytes, sha256: tiles.sha256 },
    icons: { entries: icons.entries, bytes: icons.bytes, sha256: icons.sha256 },
    defaultLanguage: source.defaultLanguage,
    languages: source.languages,
    matchingLanguageLabelIds: allLabels.length,
    surfaceMarkers: surfacePoints.length,
    surfaceItems: surfaceLabelIds.size,
    usedCategories: usedCategoryCount,
    excludedFloorMarkers: points.length - surfacePoints.length,
    externalRuntimeUrls: externalUrls,
    csp: true,
    serviceWorkerRequired: false,
  })

  // ---------- Local-only static server ----------
  await mkdir(artifacts, { recursive: true })
  server = spawn(process.execPath, [resolve(root, 'scripts/serve-offline.mjs')], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverLog = ''
  server.stdout.on('data', chunk => serverLog += chunk)
  server.stderr.on('data', chunk => serverLog += chunk)
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`Offline server exited early: ${serverLog}`)
    try {
      const response = await fetch(baseUrl)
      if (response.ok) {
        ready = true
        break
      }
    }
    catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(ready, `Offline server did not start: ${serverLog}`)

  // ---------- Fresh-profile, network-disabled browser verification ----------
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  })
  const requests = []
  const externalAttempts = []
  const failedRequests = []
  const consoleErrors = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      externalAttempts.push(url.href)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  const page = await context.newPage()
  page.on('request', request => requests.push(request.url()))
  page.on('response', (response) => {
    if (response.status() >= 400)
      failedRequests.push(`${response.status()} ${response.url()}`)
  })
  page.on('requestfailed', request => failedRequests.push(`${request.failure()?.errorText} ${request.url()}`))
  page.on('pageerror', error => consoleErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error')
      consoleErrors.push(message.text())
  })

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('canvas', { timeout: 60000 })
  await page.waitForTimeout(8000)
  assert.equal(await page.locator('html').getAttribute('lang'), 'en')
  assert(!(await page.locator('body').innerText()).includes('Offline map initialization failed'))
  const firstScreenshot = resolve(artifacts, 'offline-first-launch.png')
  await page.screenshot({ path: firstScreenshot })
  assert((await stat(firstScreenshot)).size > 100000, 'First-launch map canvas appears blank')

  const getCounts = () => page.evaluate(async () => {
    const request = indexedDB.open('AppDatabase')
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const counts = {}
    for (const name of db.objectStoreNames) {
      counts[name] = await new Promise((resolve, reject) => {
        const count = db.transaction(name).objectStore(name).count()
        count.onsuccess = () => resolve(count.result)
        count.onerror = () => reject(count.error)
      })
    }
    db.close()
    return counts
  })
  const counts = await getCounts()
  assert.equal(counts.area, 2)
  assert.equal(counts.itemType, usedCategoryCount)
  assert.equal(counts.item, surfaceLabelIds.size)
  assert.equal(counts.iconTag, surfaceLabelIds.size)
  assert.equal(counts.marker, surfacePoints.length)

  const getIconRecord = tag => page.evaluate(async (tag) => {
    const request = indexedDB.open('AppDatabase')
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const get = db.transaction('iconTag').objectStore('iconTag').get(tag)
    const record = await new Promise((resolve, reject) => {
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => reject(get.error)
    })
    db.close()
    return record
  }, tag)
  const oldIcon = await getIconRecord(testIconTag)
  assert(oldIcon?.url?.startsWith('blob:'))

  // Area → category → item, using the actual UI.
  await page.locator('.sidebar-control-layer > div > svg').first().click()
  await page.locator('.sider-menu .itemType').filter({ hasText: 'Teyvat' }).click()
  await page.locator('.sider-menu .itemType').filter({ hasText: 'Waypoints' }).click()
  await page.waitForSelector('.sider-menu .item', { timeout: 30000 })
  const selectedItem = await page.locator('.sider-menu .item').first().innerText()
  await page.locator('.sider-menu .item').first().click()
  await page.waitForTimeout(10000)
  assert((await page.locator('.sider-menu .item').first().getAttribute('class')).includes('is-select'))
  await page.locator('.sidebar-control-layer > div > svg').first().click()
  await page.waitForTimeout(1000)
  const markerScreenshot = resolve(artifacts, 'offline-markers.png')
  await page.screenshot({ path: markerScreenshot })
  assert((await stat(markerScreenshot)).size > 100000, 'Marker view appears blank')

  const preference = await page.evaluate(async () => {
    const request = indexedDB.open('AppDatabase')
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const get = db.transaction('user').objectStore('user').get(1)
    const value = await new Promise((resolve, reject) => {
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => reject(get.error)
    })
    db.close()
    return value
  })
  const temp = preference?.filterStates?.find(state => state.name === 'temp')
  const condition = temp && Object.values(temp.conditions)[0]
  const selectedItemId = condition?.items?.[0]
  assert(Number.isInteger(selectedItemId), 'Marker condition was not persisted locally')
  const expectedMarkers = surfacePoints.filter(point => point.labelId === selectedItemId).length
  assert(expectedMarkers > 0)

  // Reload with the same profile: blob URLs must be refreshed, not reused.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('canvas', { timeout: 60000 })
  await page.waitForTimeout(8000)
  const newIcon = await getIconRecord(testIconTag)
  assert(newIcon?.url?.startsWith('blob:'))
  assert.notEqual(newIcon.url, oldIcon.url, 'Stale blob URL survived reload')
  const decodedIcon = await page.evaluate(async (url) => {
    const image = new Image()
    image.src = url
    await image.decode()
    return { width: image.naturalWidth, height: image.naturalHeight }
  }, newIcon.url)
  assert(decodedIcon.width > 0 && decodedIcon.height > 0)
  assert.equal((await getCounts()).marker, surfacePoints.length)

  for (const required of ['meta.json', 'labels-en.json', 'points.json', 'tiles-index.json', 'tiles.pack', 'icons-index.json', 'icons.pack'])
    assert(requests.some(url => new URL(url).pathname.endsWith(`/offline/${required}`)), `First launch did not load local ${required}`)
  assert.deepEqual(externalAttempts, [], 'External network request attempted')
  assert.deepEqual(failedRequests, [], 'Failed browser request')
  assert.deepEqual(consoleErrors, [], 'Browser console error')

  Object.assign(report.browser, {
    freshProfile: true,
    defaultLanguage: 'en',
    serviceWorkersBlocked: true,
    externalRequestsBlocked: true,
    firstLaunchCanvas: true,
    counts,
    selectedItem: selectedItem.trim(),
    selectedItemId,
    expectedMarkers,
    localPreferencePersisted: true,
    reloadSucceeded: true,
    blobUrlsRefreshed: true,
    decodedIcon,
    externalAttempts,
    failedRequests,
    consoleErrors,
    screenshots: {
      firstLaunch: 'artifacts/offline-first-launch.png',
      markers: 'artifacts/offline-markers.png',
    },
  })
  report.success = true
}
catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(report.error)
  process.exitCode = 1
}
finally {
  if (browser)
    await browser.close()
  if (server && server.exitCode === null)
    server.kill('SIGTERM')
  await mkdir(artifacts, { recursive: true })
  await writeFile(resolve(artifacts, 'offline-verification.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

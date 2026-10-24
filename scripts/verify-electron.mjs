#!/usr/bin/env node
/** Set ELECTRON_EXECUTABLE to test a packaged binary instead of `electron .`. */
import assert from 'node:assert/strict'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifacts = resolve(root, 'artifacts')
const executable = process.env.ELECTRON_EXECUTABLE
const portableParent = resolve(artifacts, 'portable-profile')
const report = { success: false, packaged: Boolean(executable) }
let app

try {
  await mkdir(artifacts, { recursive: true })
  await rm(portableParent, { recursive: true, force: true })
  app = await electron.launch({
    ...(executable ? { executablePath: resolve(executable) } : {}),
    cwd: root,
    args: [
      '--no-sandbox',
      '--enable-webgl',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      ...(executable ? [] : ['.']),
    ],
    env: {
      ...process.env,
      PORTABLE_EXECUTABLE_DIR: portableParent,
      ELECTRON_ENABLE_LOGGING: '1',
    },
    timeout: 60000,
  })
  const page = await app.firstWindow({ timeout: 60000 })
  const errors = []
  const externalRequests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error')
      errors.push(message.text())
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.hostname !== '127.0.0.1')
      externalRequests.push(url.href)
  })

  await page.waitForSelector('canvas', { timeout: 60000 })
  await page.waitForTimeout(8000)
  assert.equal(await page.locator('html').getAttribute('lang'), 'en')
  assert.equal(new URL(page.url()).hostname, '127.0.0.1')
  assert(!(await page.locator('body').innerText()).includes('Offline map initialization failed'))

  const screenshot = resolve(artifacts, 'electron-first-launch.png')
  await page.screenshot({ path: screenshot })
  assert((await stat(screenshot)).size > 100000, 'Electron map canvas appears blank')

  const data = await page.evaluate(async () => {
    const request = indexedDB.open('AppDatabase')
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const get = (store, key) => new Promise((resolve, reject) => {
      const operation = db.transaction(store).objectStore(store).get(key)
      operation.onsuccess = () => resolve(operation.result)
      operation.onerror = () => reject(operation.error)
    })
    const count = store => new Promise((resolve, reject) => {
      const operation = db.transaction(store).objectStore(store).count()
      operation.onsuccess = () => resolve(operation.result)
      operation.onerror = () => reject(operation.error)
    })
    const [item, markers, language] = await Promise.all([
      get('item', 2),
      count('marker'),
      get('md5', 'offline-snapshot'),
    ])
    db.close()
    return { itemName: item?.name, markers, snapshotVersion: language?.value }
  })
  assert.equal(data.itemName, 'Statue of The Seven')
  assert.equal(data.markers, 85788)
  assert(data.snapshotVersion?.endsWith(':en'))

  // Open the real settings dialog from the map sidebar.
  await page.locator('.sidebar-control-layer > div > svg').first().click()
  await page.getByLabel('Open settings').click()
  await page.waitForSelector('.setting-panel', { timeout: 15000 })
  const settingsText = await page.locator('.setting-panel').innerText()
  assert(settingsText.includes('Marker language'))
  assert(settingsText.includes('General'))
  const settingsScreenshot = resolve(artifacts, 'electron-settings.png')
  await page.screenshot({ path: settingsScreenshot })

  // Language changes rebuild names only; local completion data must survive.
  await page.evaluate(() => {
    localStorage.setItem('__ysmap_archive', JSON.stringify({
      Data_KYJG: [1],
      Time_KYJG: {},
      updated_at: Date.now(),
    }))
  })
  await page.locator('.setting-panel .el-select input').click()
  const chineseNavigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.locator('.el-select-dropdown__item:visible').filter({ hasText: '简体中文' }).click()
  await chineseNavigation
  await page.waitForSelector('canvas', { timeout: 60000 })
  await page.waitForTimeout(8000)
  const chineseName = await page.evaluate(async () => {
    const request = indexedDB.open('AppDatabase')
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const get = db.transaction('item').objectStore('item').get(2)
    const item = await new Promise((resolve, reject) => {
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => reject(get.error)
    })
    db.close()
    return item?.name
  })
  assert.equal(chineseName, '七天神像')
  const preservedArchive = await page.evaluate(() => localStorage.getItem('__ysmap_archive'))
  assert(JSON.parse(preservedArchive).Data_KYJG.includes(1))

  await page.locator('.sidebar-control-layer > div > svg').first().click()
  await page.getByLabel('Open settings').click()
  await page.waitForSelector('.setting-panel', { timeout: 15000 })
  await page.locator('.setting-panel .el-select input').click()
  const englishNavigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.locator('.el-select-dropdown__item:visible').filter({ hasText: 'English' }).click()
  await englishNavigation
  await page.waitForSelector('canvas', { timeout: 60000 })
  await page.waitForTimeout(8000)
  assert.equal(await page.evaluate(() => localStorage.getItem('__genshin_map_marker_language')), 'en')

  assert.deepEqual(externalRequests, [])
  assert.deepEqual(errors, [])
  Object.assign(report, data, {
    success: true,
    loopbackOnly: true,
    defaultLanguage: 'en',
    chineseLanguageSwitch: true,
    englishLanguageRestore: true,
    completionPreservedAcrossLanguages: true,
    externalRequests,
    errors,
    screenshots: {
      firstLaunch: 'artifacts/electron-first-launch.png',
      settings: 'artifacts/electron-settings.png',
    },
  })
}
catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(report.error)
  process.exitCode = 1
}
finally {
  if (app)
    await app.close()
  await mkdir(artifacts, { recursive: true })
  await writeFile(resolve(artifacts, 'electron-verification.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

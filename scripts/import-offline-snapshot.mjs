#!/usr/bin/env node
/**
 * Import an already-downloaded genshin-map-data snapshot into the app.
 * This is a maintenance command only. It is never needed to run the app.
 *
 * Usage: node scripts/import-offline-snapshot.mjs /path/to/data/teyvat
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = resolve(process.argv[2] ?? '')
if (!process.argv[2]) {
  console.error('Usage: node scripts/import-offline-snapshot.mjs /path/to/data/teyvat')
  process.exit(1)
}

const target = resolve(root, 'public/offline')
const tilesSource = resolve(source, 'tiles')
const iconsSource = resolve(source, 'icons')
const required = ['meta.json', 'labels.json', 'points.json']

await mkdir(target, { recursive: true })
for (const file of required)
  await copyFile(resolve(source, file), resolve(target, file))
await rm(resolve(target, 'icons'), { recursive: true, force: true })

const createPack = async (directory, names, format, keyPrefix = '') => {
  const chunks = []
  const entries = {}
  let offset = 0
  for (const name of names) {
    const data = await readFile(resolve(directory, name))
    entries[`${keyPrefix}${name}`] = [offset, data.byteLength]
    chunks.push(data)
    offset += data.byteLength
  }
  const bytes = Buffer.concat(chunks, offset)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { bytes, entries, byteLength: offset, sha256, format }
}

const tileNames = (await readdir(tilesSource, { withFileTypes: true }))
  .filter(entry => entry.isFile() && /^\d+_\d+_(?:N\d+|P0)\.webp$/.test(entry.name))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b, 'en'))
if (!tileNames.length)
  throw new Error(`No tiles found in ${tilesSource}`)
const tiles = await createPack(tilesSource, tileNames, 'genshin-offline-tile-pack')
await writeFile(resolve(target, 'tiles.pack'), tiles.bytes)
await writeFile(resolve(target, 'tiles-index.json'), `${JSON.stringify({
  format: tiles.format,
  version: 1,
  byteLength: tiles.byteLength,
  sha256: tiles.sha256,
  entries: tiles.entries,
})}\n`)

const iconNames = (await readdir(iconsSource, { withFileTypes: true }))
  .filter(entry => entry.isFile() && /^[\w.-]+\.webp$/.test(entry.name))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b, 'en'))
if (!iconNames.length)
  throw new Error(`No icons found in ${iconsSource}`)
const icons = await createPack(iconsSource, iconNames, 'genshin-offline-icon-pack', 'icons/')
await writeFile(resolve(target, 'icons.pack'), icons.bytes)
await writeFile(resolve(target, 'icons-index.json'), `${JSON.stringify({
  format: icons.format,
  version: 1,
  byteLength: icons.byteLength,
  sha256: icons.sha256,
  entries: icons.entries,
})}\n`)

const rawMeta = JSON.parse(await readFile(resolve(target, 'meta.json'), 'utf8'))
const { mapId, mapVersion, gameVersion, origin, totalSize, minZoom, maxZoom, fetchedAt } = rawMeta
const meta = { mapId, mapVersion, gameVersion, origin, totalSize, minZoom, maxZoom, fetchedAt }
await writeFile(resolve(target, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
const labels = JSON.parse(await readFile(resolve(target, 'labels.json'), 'utf8'))
const points = JSON.parse(await readFile(resolve(target, 'points.json'), 'utf8'))
const surfacePoints = points.filter(point => !point.z)
let englishLabels
try {
  englishLabels = JSON.parse(await readFile(resolve(target, 'labels-en.json'), 'utf8'))
}
catch (error) {
  if (error.code !== 'ENOENT')
    throw error
}
if (englishLabels) {
  const collectIds = (nodes, ids = new Set()) => {
    for (const node of nodes) {
      ids.add(node.id)
      collectIds(node.children ?? [], ids)
    }
    return ids
  }
  const sourceIds = collectIds(labels)
  const englishIds = collectIds(englishLabels)
  const missing = [...sourceIds].filter(id => !englishIds.has(id))
  const extra = [...englishIds].filter(id => !sourceIds.has(id))
  if (missing.length || extra.length)
    throw new Error(`English labels do not match this snapshot (missing: ${missing.length}, extra: ${extra.length}). Update labels-en.json before importing.`)
}
await writeFile(resolve(target, 'source.json'), `${JSON.stringify({
  snapshot: 'https://github.com/kxxoling/genshin-map-data',
  upstream: 'HoYoverse public interactive map snapshot',
  mapVersion: meta.mapVersion,
  gameVersion: meta.gameVersion,
  fetchedAt: meta.fetchedAt,
  tileCount: tileNames.length,
  tileBytes: tiles.byteLength,
  tileSha256: tiles.sha256,
  iconCount: iconNames.length,
  iconBytes: icons.byteLength,
  iconSha256: icons.sha256,
  categoryCount: labels.length,
  defaultLanguage: englishLabels ? 'en' : 'zh-CN',
  languages: englishLabels ? ['en', 'zh-CN'] : ['zh-CN'],
  surfaceMarkerCount: surfacePoints.length,
  excludedFloorMarkerCount: points.length - surfacePoints.length,
}, null, 2)}\n`)

console.log(`Imported ${tileNames.length} tiles (${(tiles.byteLength / 1024 / 1024).toFixed(1)} MiB), ${iconNames.length} packed icons, ${labels.length} categories, and ${surfacePoints.length} surface markers.`)
console.log(`Tile pack SHA-256: ${tiles.sha256}`)
console.log(`Icon pack SHA-256: ${icons.sha256}`)

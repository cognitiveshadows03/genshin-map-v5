import { fetchOffline, fetchOfflineJson, offlineAsset } from './assets'

interface TilePackIndex {
  format: 'genshin-offline-tile-pack'
  version: number
  byteLength: number
  sha256: string
  entries: Record<string, [offset: number, length: number]>
}

interface LoadedTilePack {
  bytes: ArrayBuffer
  entries: TilePackIndex['entries']
}

const PACK_CACHE = 'genshin-tile-pack-v1'
let tilePackPromise: Promise<LoadedTilePack> | undefined

/**
 * Load the local tile bundle once. The 73 MiB pack replaces 13,770 runtime
 * requests while keeping every original tile byte-for-byte unchanged.
 * A versioned page-managed cache also lets the service worker serve it on a
 * later launch without making first-launch static operation depend on Cache API.
 */
export const preloadTilePack = () => {
  if (!tilePackPromise) {
    tilePackPromise = (async () => {
      const index = await fetchOfflineJson<TilePackIndex>('tiles-index.json')
      if (index.format !== 'genshin-offline-tile-pack' || index.version !== 1)
        throw new Error('Unsupported offline tile pack format')

      const resourcePath = `tiles.pack?sha256=${index.sha256}`
      const resourceUrl = offlineAsset(resourcePath)
      let cache: Cache | undefined
      let cached: Response | undefined
      try {
        if ('caches' in window) {
          cache = await caches.open(PACK_CACHE)
          cached = await cache.match(resourceUrl)
        }
      }
      catch {
        cache = undefined
      }

      let response = cached ?? await fetchOffline(resourcePath)
      let responseForCache = cached ? undefined : response.clone()
      let bytes = await response.arrayBuffer()

      // Recover automatically if a previously cached entry was truncated.
      if (cached && bytes.byteLength !== index.byteLength) {
        response = await fetchOffline(resourcePath)
        responseForCache = response.clone()
        bytes = await response.arrayBuffer()
      }
      if (bytes.byteLength !== index.byteLength)
        throw new Error(`Offline tile pack is truncated: expected ${index.byteLength} bytes, received ${bytes.byteLength}`)

      if (cache && responseForCache) {
        try {
          await cache.put(resourceUrl, responseForCache)
          const keys = await cache.keys()
          await Promise.all(keys
            .filter(request => request.url !== resourceUrl)
            .map(request => cache.delete(request)))
        }
        catch {
          // Cache API is only an enhancement; the local static pack loaded fine.
        }
      }
      return { bytes, entries: index.entries }
    })().catch((error) => {
      tilePackPromise = undefined
      throw error
    })
  }
  return tilePackPromise
}

/** Return one tile from the in-memory local pack, or null for an ocean tile. */
export const getOfflineTile = async (name: string) => {
  const { bytes, entries } = await preloadTilePack()
  const entry = entries[name]
  if (!entry)
    return null
  const [offset, length] = entry
  return new Blob([bytes.slice(offset, offset + length)], { type: 'image/webp' })
}

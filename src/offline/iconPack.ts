import { fetchOffline, fetchOfflineJson } from './assets'

interface IconPackIndex {
  format: 'genshin-offline-icon-pack'
  version: number
  byteLength: number
  sha256: string
  entries: Record<string, [offset: number, length: number]>
}

let iconPackPromise: Promise<Record<string, string>> | undefined

/**
 * Unpack all marker icons into session-local blob URLs. Blob URLs are never
 * treated as persistent snapshot data; bootstrap refreshes them every launch.
 */
export const preloadIconPack = () => {
  if (!iconPackPromise) {
    iconPackPromise = (async () => {
      const [index, response] = await Promise.all([
        fetchOfflineJson<IconPackIndex>('icons-index.json'),
        fetchOffline('icons.pack'),
      ])
      if (index.format !== 'genshin-offline-icon-pack' || index.version !== 1)
        throw new Error('Unsupported offline icon pack format')
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== index.byteLength)
        throw new Error(`Offline icon pack is truncated: expected ${index.byteLength} bytes, received ${bytes.byteLength}`)

      const urls: Record<string, string> = {}
      for (const [path, [offset, length]] of Object.entries(index.entries)) {
        const blob = new Blob([bytes.slice(offset, offset + length)], { type: 'image/webp' })
        urls[path] = URL.createObjectURL(blob)
      }
      return urls
    })().catch((error) => {
      iconPackPromise = undefined
      throw error
    })
  }
  return iconPackPromise
}

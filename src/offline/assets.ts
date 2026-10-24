/** Resolve a bundled offline resource against the deployed app base URL. */
export const offlineAsset = (path: string) => {
  const cleanPath = path.replace(/^\/+/, '')
  return new URL(`${import.meta.env.BASE_URL}offline/${cleanPath}`, document.baseURI).href
}

/** Fetch a same-origin resource and reject HTML/error responses early. */
export const fetchOffline = async (path: string, init?: RequestInit) => {
  const response = await fetch(offlineAsset(path), {
    cache: 'force-cache',
    ...init,
  })
  if (!response.ok)
    throw new Error(`Offline resource "${path}" is unavailable (HTTP ${response.status})`)
  return response
}

export const fetchOfflineJson = async <T>(path: string): Promise<T> => {
  return (await fetchOffline(path)).json() as Promise<T>
}

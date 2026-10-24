import type { AxiosRequestConfig } from 'axios'

/**
 * Final network guard for every legacy generated API client.
 * Offline data access goes through src/offline, never through this function.
 */
export const request = async <T>(_url: string, _options: AxiosRequestConfig = {}): Promise<T> => {
  throw new Error('此版本为完全离线地图：远程 API、账户同步和在线编辑已禁用。')
}

// Kept as an export for compatibility with legacy imports; it is not an Axios
// instance and deliberately rejects instead of dispatching a request.
export const axiosInstance = request

export const MARKER_LANGUAGE_KEY = '__genshin_map_marker_language'

export type MarkerLanguage = 'en' | 'zh-CN'

export const getMarkerLanguage = (): MarkerLanguage => {
  return localStorage.getItem(MARKER_LANGUAGE_KEY) === 'zh-CN' ? 'zh-CN' : 'en'
}

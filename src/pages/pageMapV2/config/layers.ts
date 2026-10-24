import type { TagOptions } from './tags'
import type { OverlayOptions } from './overlays'

/** 底图配置。离线版使用官方快照的像素坐标与切片金字塔。 */
export interface LayerConfig {
  code: string
  name: string
  extension?: string
  size: [w: number, h: number]
  tilesOffset?: [x: number, y: number]
  center?: [x: number, y: number]
  areaCodes?: string[]
  tags?: TagOptions[]
  overlays?: OverlayOptions[]
  initViewState?: {
    target?: [number, number]
    zoom?: number
    minZoom?: number
    maxZoom?: number
  }
}

export const LAYER_CONFIGS: LayerConfig[] = [
  {
    code: 'teyvat',
    name: 'Teyvat (offline snapshot)',
    extension: 'webp',
    size: [36864, 18432],
    tilesOffset: [0, 0],
    // Official snapshot: pixel = game coordinate + origin.
    center: [24206, 8918],
    areaCodes: ['A:OFFICIAL:TEYVAT'],
    tags: [],
    overlays: [],
    initViewState: {
      target: [0, 0],
      zoom: -3,
      minZoom: -4,
      maxZoom: 2,
    },
  },
]

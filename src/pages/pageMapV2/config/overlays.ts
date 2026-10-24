export interface OverlayOptions {
  name: string
  url: string
  bounds: [xmin: number, ymin: number, xmax: number, ymax: number]
  areaCode: string
  groupBy?: string
}

/**
 * The frozen offline snapshot contains the surface map only.
 * No remote underground overlays are referenced or requested.
 */
export const LAYER_OVERLAY_CONFIG: Record<string, OverlayOptions[]> = {}

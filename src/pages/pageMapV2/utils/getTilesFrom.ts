import { BitmapLayer } from '@deck.gl/layers/typed'
import { TileLayer } from '@deck.gl/geo-layers/typed'
import type { GenshinBaseLayer } from '../core'
import { getOfflineTile } from '@/offline'

const zoomSuffix = (zoom: number) => `${zoom < 0 ? 'N' : 'P'}${Math.abs(zoom)}`

/** Read tiles exclusively from the bundled, byte-for-byte local snapshot. */
export const getTilesFrom = (target: GenshinBaseLayer): TileLayer => new TileLayer({
  id: `${target.props.id}-tile`,
  pickable: target.context.deck.stateManager.get('showTooltip'),
  coordinateSystem: target.rawProps.coordinateSystem,
  coordinateOrigin: target.rawProps.coordinateOrigin,
  data: null,
  tileSize: 256,
  minZoom: -3,
  maxZoom: 0,
  maxRequests: 6,
  // TileLayer expects [minX, minY, maxX, maxY]. GenshinBaseLayer.bounds
  // deliberately uses BitmapLayer's [minX, maxY, maxX, minY] ordering.
  extent: [
    target.rawProps.bounds[0],
    target.rawProps.bounds[3],
    target.rawProps.bounds[2],
    target.rawProps.bounds[1],
  ],
  opacity: target.context.deck.stateManager.get('showOverlay') ? 0.3 : 1,
  maxCacheSize: target.context.deck.stateManager.get('maxCacheTileSize'),
  getTileData: async ({ index: { x, y, z }, signal }) => {
    if (signal?.aborted)
      return null
    const blob = await getOfflineTile(`${x}_${y}_${zoomSuffix(z)}.webp`)
    if (!blob || signal?.aborted)
      return null
    const image = await createImageBitmap(blob)
    return {
      byteLength: blob.size,
      image,
    }
  },
  renderSubLayers: (subProps) => {
    if (!subProps.data)
      return null
    const [[xmin, ymin], [xmax, ymax]] = subProps.tile.boundingBox
    return new BitmapLayer(subProps, {
      data: undefined,
      image: subProps.data.image,
      bounds: [xmin, ymax, xmax, ymin],
    })
  },
})

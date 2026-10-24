import { fetchOfflineJson } from './assets'
import { preloadIconPack } from './iconPack'
import { getMarkerLanguage } from './language'
import db from '@/database'

export const OFFLINE_AREA_CODE = 'A:OFFICIAL:TEYVAT'
export const OFFLINE_PARENT_AREA_CODE = 'C:OFFICIAL'
const SNAPSHOT_KEY = 'offline-snapshot'
const AREA_ID = 2

interface OfficialMeta {
  mapVersion: string
}

interface OfficialLabel {
  id: number
  name: string
  icon: string
  children?: OfficialLabel[]
}

interface OfficialPoint {
  id: number
  labelId: number
  x: number
  y: number
  z?: number
}

const ensureLocalUser = () => {
  localStorage.setItem('__ys_user_info', JSON.stringify({
    id: 1,
    username: 'offline',
    nickname: 'Local User',
    logo: '',
  }))
  localStorage.removeItem('__ys_dadian_auth')
}

/**
 * Seed IndexedDB exclusively from resources shipped with the app.
 * Runs before Vue mounts, including on a completely fresh browser profile.
 */
export const bootstrapOffline = async () => {
  ensureLocalUser()

  const language = getMarkerLanguage()
  const [meta, labels, allPoints, iconUrls] = await Promise.all([
    fetchOfflineJson<OfficialMeta>('meta.json'),
    fetchOfflineJson<OfficialLabel[]>(language === 'en' ? 'labels-en.json' : 'labels.json'),
    fetchOfflineJson<OfficialPoint[]>('points.json'),
    preloadIconPack(),
  ])

  // Floor-specific points need their own floor maps. Rendering them on the
  // surface pyramid would place them incorrectly, so keep them out of the DB.
  const points = allPoints.filter(point => !point.z)
  const usedLabelIds = new Set(points.map(point => point.labelId))
  const categories = labels.map(category => ({
    ...category,
    children: (category.children ?? []).filter(item => usedLabelIds.has(item.id)),
  })).filter(category => category.children.length)

  const iconTagFor = (id: number) => `official-${id}`
  const areas: API.AreaVo[] = [
    {
      id: 1,
      parentId: -1,
      name: language === 'en' ? 'Offline Map' : '离线地图',
      code: OFFLINE_PARENT_AREA_CODE,
      isFinal: false,
      hiddenFlag: 0,
      specialFlag: 1,
    },
    {
      id: AREA_ID,
      parentId: 1,
      name: language === 'en' ? 'Teyvat' : '提瓦特',
      code: OFFLINE_AREA_CODE,
      content: `${language === 'en' ? 'Local snapshot' : '本地快照'} ${meta.mapVersion}`,
      iconTag: categories[0]?.children[0] ? iconTagFor(categories[0].children[0].id) : undefined,
      isFinal: true,
      hiddenFlag: 0,
      specialFlag: 1,
    },
  ]

  const itemTypes: API.ItemTypeVo[] = categories.map((category, index) => ({
    id: category.id,
    parentId: -1,
    name: category.name,
    iconTag: category.children[0] ? iconTagFor(category.children[0].id) : undefined,
    isFinal: true,
    hiddenFlag: 0,
    sortIndex: categories.length - index,
  }))

  const items: API.ItemVo[] = []
  const iconTags: API.TagVo[] = []
  const itemNames = new Map<number, string>()
  for (const category of categories) {
    category.children.forEach((item, index) => {
      const iconTag = iconTagFor(item.id)
      itemNames.set(item.id, item.name)
      items.push({
        id: item.id,
        areaId: AREA_ID,
        name: item.name,
        defaultCount: 1,
        defaultRefreshTime: 0,
        iconTag,
        hiddenFlag: 0,
        specialFlag: 1,
        sortIndex: category.children.length - index,
        typeIdList: [category.id],
      })
      const url = iconUrls[item.icon]
      if (!url)
        throw new Error(`Offline icon is missing from icons.pack: ${item.icon}`)
      iconTags.push({
        tag: iconTag,
        iconId: item.id,
        typeIdList: [category.id],
        url,
      })
    })
  }

  const markers: API.MarkerVo[] = points.map(point => ({
    id: point.id,
    markerTitle: itemNames.get(point.labelId) ?? (language === 'en' ? 'Map marker' : '地图点位'),
    position: `${point.x},${point.y}`,
    itemList: [{
      itemId: point.labelId,
      count: 1,
      iconTag: iconTagFor(point.labelId),
    }],
    content: '',
    refreshTime: 0,
    hiddenFlag: 0,
    extra: {},
  }))

  const snapshotVersion = `${meta.mapVersion}:${language}`
  const previous = await db.md5.get(SNAPSHOT_KEY)
  const isComplete = previous?.value === snapshotVersion
    && await db.area.count() === areas.length
    && await db.itemType.count() === itemTypes.length
    && await db.marker.count() === markers.length
    && await db.item.count() === items.length
    && await db.iconTag.count() === iconTags.length

  if (!isComplete) {
    await db.transaction('rw', [db.area, db.itemType, db.item, db.iconTag, db.marker, db.md5], async () => {
      await Promise.all([
        db.area.clear(),
        db.itemType.clear(),
        db.item.clear(),
        db.iconTag.clear(),
        db.marker.clear(),
      ])
      await db.area.bulkPut(areas)
      await db.itemType.bulkPut(itemTypes)
      await db.item.bulkPut(items)
      await db.iconTag.bulkPut(iconTags)
      for (let offset = 0; offset < markers.length; offset += 5000)
        await db.marker.bulkPut(markers.slice(offset, offset + 5000))
      await db.md5.put({ id: SNAPSHOT_KEY, value: snapshotVersion })
    })
  }
  else {
    // Blob URLs are session-scoped and must be replaced after every reload.
    await db.iconTag.bulkPut(iconTags)
  }

  return {
    version: snapshotVersion,
    language,
    areas: areas.length,
    categories: itemTypes.length,
    items: items.length,
    markers: markers.length,
  }
}

import { defineStore } from 'pinia'
import { liveQuery } from 'dexie'
import db from '@/database'

/** Local area data seeded exclusively from bundled snapshots. */
export const useAreaStore = defineStore('global-area', {
  state: () => ({
    _areaList: [] as API.AreaVo[],
    total: 0,
  }),
  getters: {
    areaMap: state => Object.fromEntries(state._areaList.map(area => [
      area.id as number,
      area,
    ])) as Record<string, API.AreaVo>,
  },
})

liveQuery(() => db.area.toArray()).subscribe((areaList) => {
  const store = useAreaStore()
  store._areaList = areaList
  store.total = areaList.length
})

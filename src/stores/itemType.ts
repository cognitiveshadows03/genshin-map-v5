import { defineStore } from 'pinia'
import { liveQuery } from 'dexie'
import db from '@/database'

/** Local item-category data seeded exclusively from bundled snapshots. */
export const useItemTypeStore = defineStore('global-item-type', {
  state: () => ({
    _itemTypeList: [] as API.ItemTypeVo[],
    total: 0,
  }),
  getters: {
    itemTypeMap: state => Object.fromEntries(state._itemTypeList.map(itemType => [
      itemType.id as number,
      itemType,
    ])) as Record<string, API.ItemTypeVo>,
  },
})

liveQuery(() => db.itemType.toArray()).subscribe((itemTypeList) => {
  const store = useItemTypeStore()
  store._itemTypeList = itemTypeList
  store.total = itemTypeList.length
})

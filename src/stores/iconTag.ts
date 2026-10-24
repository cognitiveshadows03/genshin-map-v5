import { defineStore } from 'pinia'
import { liveQuery } from 'dexie'
import db from '@/database'

/** Local icon-tag data; blob URLs are refreshed by offline bootstrap. */
export const useIconTagStore = defineStore('global-icon-tag', {
  state: () => ({
    _iconList: [] as API.TagVo[],
    total: 0,
  }),
  getters: {
    iconTagMap: state => Object.fromEntries(state._iconList.map(iconTag => [
      iconTag.tag as string,
      iconTag,
    ])) as Record<string, API.TagVo>,
  },
})

liveQuery(() => db.iconTag.toArray()).subscribe((iconTagList) => {
  const store = useIconTagStore()
  store._iconList = iconTagList
  store.total = iconTagList.length
})

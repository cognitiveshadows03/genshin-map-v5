import { defineStore } from 'pinia'
import { liveQuery } from 'dexie'
import db from '@/database'

export const useMarkerStore = defineStore('global-marker', {
  state: () => ({ total: 0 }),
})

liveQuery(() => db.marker.count()).subscribe((total) => {
  useMarkerStore().total = total
})

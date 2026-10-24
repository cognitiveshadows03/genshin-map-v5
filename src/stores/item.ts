import { defineStore } from 'pinia'
import { liveQuery } from 'dexie'
import db from '@/database'

export const useItemStore = defineStore('global-item', {
  state: () => ({ total: 0 }),
})

liveQuery(() => db.item.count()).subscribe((total) => {
  useItemStore().total = total
})

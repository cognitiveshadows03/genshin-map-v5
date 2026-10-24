import { defineStore } from 'pinia'

export interface ArchiveBody {
  /** 已标记点位 */
  Data_KYJG: Set<number>
  /** 刷新时间存档，格式 YYYY/MM/DD HH:mm:ss */
  Time_KYJG: Record<number, string>
  /** 最新修改时间 */
  updated_at: number
}

const createArchive = (): ArchiveBody => ({
  Data_KYJG: new Set(),
  Time_KYJG: {},
  updated_at: Date.now(),
})

// localStorage JSON cannot represent Set directly. Store its values as an
// array and restore a real Set before any marker layer reads it.
const localArchive = useStorage<ArchiveBody>('__ysmap_archive', createArchive(), localStorage, {
  serializer: {
    read: (raw) => {
      try {
        const value = JSON.parse(raw) as Partial<ArchiveBody>
        return {
          Data_KYJG: new Set(Array.isArray(value.Data_KYJG) ? value.Data_KYJG : []),
          Time_KYJG: value.Time_KYJG ?? {},
          updated_at: value.updated_at ?? Date.now(),
        }
      }
      catch {
        return createArchive()
      }
    },
    write: value => JSON.stringify({
      ...value,
      Data_KYJG: [...value.Data_KYJG],
    }),
  },
})

/** Offline archive management: one local slot, no cloud account or API. */
export const useArchiveStore = defineStore('global-archive', {
  state: () => ({
    fetchLoading: false,
  }),

  getters: {
    currentArchive: () => localArchive.value,
  },

  actions: {},
})

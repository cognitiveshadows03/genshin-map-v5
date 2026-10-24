import type { ShallowRef } from 'vue'
import dayjs from 'dayjs'
import { useArchiveStore } from '@/stores'
import { useMap } from '@/pages/pageMapV2/hooks'

export const useMarkerFinished = (markerInfo: ShallowRef<API.MarkerVo | null>) => {
  const archiveStore = useArchiveStore()
  const { map } = useMap()

  const isFinished = computed({
    get: () => {
      if (markerInfo.value?.id === undefined)
        return false
      return archiveStore.currentArchive.Data_KYJG.has(markerInfo.value.id)
    },
    set: (finished) => {
      const id = markerInfo.value?.id
      if (id === undefined)
        return
      if (finished) {
        archiveStore.currentArchive.Data_KYJG.add(id)
        archiveStore.currentArchive.Time_KYJG[id] = dayjs().format('YYYY/MM/DD HH:mm:ss')
      }
      else {
        archiveStore.currentArchive.Data_KYJG.delete(id)
        archiveStore.currentArchive.Time_KYJG[id] = ''
      }
      archiveStore.currentArchive.updated_at = Date.now()
      map.value?.baseLayer?.forceUpdate()
    },
  })

  return { isFinished }
}

<script lang="ts" setup>
import { SettingItem } from '.'
import { localSettings } from '@/stores'
import { MARKER_LANGUAGE_KEY } from '@/offline'
import type { MarkerLanguage } from '@/offline'

const markerLanguage = useLocalStorage<MarkerLanguage>(MARKER_LANGUAGE_KEY, 'en')
const reloadForLanguage = () => window.location.reload()

const usageStorage = ref(0)
const quotaStorage = ref(0)
const usagePercentage = computed(() => Math.floor(100 * (usageStorage.value / quotaStorage.value) || 0))
const calculateCaches = async () => {
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  usageStorage.value = usage / 10 ** 9
  quotaStorage.value = quota / 10 ** 9
}
calculateCaches()

const cacheLoading = ref(false)
const clearAllCaches = async () => {
  try {
    cacheLoading.value = true
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)))
    await calculateCaches()
  }
  catch {
    // The app can recreate its versioned pack cache on the next launch.
  }
  finally {
    cacheLoading.value = false
  }
}
</script>

<template>
  <el-scrollbar>
    <div class="flex flex-col">
      <SettingItem
        label="Marker language"
        content="English is the default. Changing language rebuilds local names while preserving completion and filter data."
      >
        <el-select v-model="markerLanguage" aria-label="Marker language" @change="reloadForLanguage">
          <el-option label="English" value="en" />
          <el-option label="简体中文" value="zh-CN" />
        </el-select>
      </SettingItem>

      <SettingItem
        label="Center on filtered markers"
        content="Move to the geometric center after the selected markers finish loading."
      >
        <el-switch v-model="localSettings.moveToCenter" />
      </SettingItem>

      <SettingItem
        label="Advance filters automatically"
        content="Move to the next filter level after an area or category is selected."
      >
        <el-switch v-model="localSettings.autoTurnNext" />
      </SettingItem>

      <SettingItem label="Local storage">
        <template #content>
          <div class="flex flex-col gap-1">
            <el-progress class="progress-base-radius" text-inside :stroke-width="20" :percentage="usagePercentage" />
            <div>
              Estimated storage: {{ usageStorage.toFixed(1) }} / {{ quotaStorage.toFixed(1) }} GB.
              The quota is reported by the browser and is not guaranteed free space.
            </div>
          </div>
        </template>
        <el-button :loading="cacheLoading" @click="clearAllCaches">
          Clear pack cache
        </el-button>
      </SettingItem>
    </div>
  </el-scrollbar>
</template>

<style lang="scss" scoped>
.progress-base-radius {
  :deep(.el-progress-bar__outer) {
    border-radius: 6px;
  }
  :deep(.el-progress-bar__inner) {
    border-radius: 6px;
  }
}
</style>

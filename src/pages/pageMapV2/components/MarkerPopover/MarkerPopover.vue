<script lang="ts" setup>
import { Check, CirclePlus } from '@element-plus/icons-vue'
import { covertPosition } from '../../utils'
import { useCondition, useMap, useMarkerFocus } from '../../hooks'
import { MapAffix } from '..'
import { MarkerPanel } from './components'
import { useMarkerExtra, useMarkerFinished } from './hooks'
import { useIconTagStore } from '@/stores'
import { CloseFilled } from '@/components/GenshinUI/GSIcon'
import { GSButton } from '@/components'

const iconTagStore = useIconTagStore()

const { cachedMarkerVo, focus, blur } = useMarkerFocus()

const { isFinished } = useMarkerFinished(cachedMarkerVo)

const { isUnderground, hiddenFlagType, refreshTimeType } = useMarkerExtra(cachedMarkerVo)

const { map } = useMap()
const conditionManager = useCondition()
watch(() => conditionManager.layerMarkerMap[map.value?.baseLayer?.rawProps.code ?? ''], blur)
</script>

<template>
  <MapAffix v-if="cachedMarkerVo" :pos="covertPosition(cachedMarkerVo.position)" :pickable="Boolean(focus)">
    <MarkerPanel :actived="Boolean(focus)">
      <template #header>
        <img :src="iconTagStore.iconTagMap[cachedMarkerVo.itemList?.[0].iconTag ?? '']?.url" crossorigin="" class="w-7 h-7 object-contain">
        <span class="flex-1 text-lg">
          {{ cachedMarkerVo.markerTitle }}
          <span class="text-sm">(ID: {{ cachedMarkerVo.id }})</span>
        </span>
        <el-icon :size="28" color="#ECE5D8" class="hover:brightness-90 active:brightness-50 cursor-pointer p-1" @click="blur">
          <CloseFilled />
        </el-icon>
      </template>

      <template #content>
        <p v-for="line in cachedMarkerVo.content?.trim().split('\n')" :key="line" class="leading-6">
          {{ line }}
        </p>
      </template>

      <template #append>
        <div class="flex gap-1 p-2 pt-0">
          <el-tag>{{ isUnderground ? 'Underground' : 'Surface' }}</el-tag>
          <el-tag>{{ hiddenFlagType }}</el-tag>
          <el-tag>Refresh: {{ refreshTimeType }}</el-tag>
        </div>
      </template>

      <template #footer>
        <GSButton :theme="isFinished ? undefined : 'dark'" class="flex-1" size="small" @click="isFinished = !isFinished">
          <template #icon>
            <el-icon :color="isFinished ? 'var(--el-color-success)' : 'var(--el-color-info)'">
              <component :is="isFinished ? Check : CirclePlus" />
            </el-icon>
          </template>
          {{ isFinished ? 'Completed' : 'Complete' }}
        </GSButton>
      </template>
    </MarkerPanel>
  </MapAffix>
</template>

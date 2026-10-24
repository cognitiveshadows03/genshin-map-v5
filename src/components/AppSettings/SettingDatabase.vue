<script lang="ts" setup>
import { WarnTriangleFilled } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { SettingItem } from '.'
import { useAreaStore, useIconTagStore, useItemStore, useItemTypeStore, useMarkerStore } from '@/stores'
import { useFetchHook } from '@/hooks'
import db from '@/database'

interface StoreLike {
  total: number
}

const storeList: { name: string; store: StoreLike }[] = [
  { name: '地区', store: useAreaStore() },
  { name: '图标', store: useIconTagStore() },
  { name: '物品', store: useItemStore() },
  { name: '物品类型', store: useItemTypeStore() },
  { name: '点位', store: useMarkerStore() },
]

const { refresh: resetDatabase } = useFetchHook({
  onRequest: async () => {
    await ElMessageBox.confirm('将从随附快照重建本地数据库；完成标记和筛选设置会保留。确认操作？', '恢复离线数据', {
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    })
    await Promise.all([
      db.area.clear(),
      db.itemType.clear(),
      db.item.clear(),
      db.iconTag.clear(),
      db.marker.clear(),
    ])
    window.location.reload()
  },
})
</script>

<template>
  <el-scrollbar>
    <div class="flex flex-col">
      <el-alert type="info" center :closable="false" class="mb-2">
        数据已随应用内置，不会执行联网更新。
      </el-alert>
      <SettingItem
        v-for="store in storeList"
        :key="store.name"
        :label="`${store.name}数据`"
        :content="`本地快照已存储${store.name}数据 ${store.store.total} 项。`"
      />
      <SettingItem
        label="从快照重建数据库"
        content="当本地数据损坏时，使用应用目录中的 JSON 快照恢复。"
      >
        <el-button type="danger" :icon="WarnTriangleFilled" @click="resetDatabase">
          从快照重建
        </el-button>
      </SettingItem>
    </div>
  </el-scrollbar>
</template>

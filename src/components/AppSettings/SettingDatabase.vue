<script lang="ts" setup>
import { WarnTriangleFilled } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { SettingItem } from '.'
import { useAreaStore, useIconTagStore, useItemStore, useItemTypeStore, useMarkerStore } from '@/stores'
import { useAsyncTask } from '@/hooks'
import db from '@/database'

interface StoreLike {
  total: number
}

const storeList: { name: string; store: StoreLike }[] = [
  { name: 'Areas', store: useAreaStore() },
  { name: 'Icons', store: useIconTagStore() },
  { name: 'Items', store: useItemStore() },
  { name: 'Categories', store: useItemTypeStore() },
  { name: 'Markers', store: useMarkerStore() },
]

const { refresh: resetDatabase } = useAsyncTask({
  task: async () => {
    await ElMessageBox.confirm(
      'Rebuild the local database from the bundled snapshot? Completion markers and filter preferences will be preserved.',
      'Restore offline data',
      {
        type: 'warning',
        confirmButtonText: 'Rebuild',
        cancelButtonText: 'Cancel',
        confirmButtonClass: 'el-button--danger',
      },
    )
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
        All map data is bundled with the app. No downloads or online updates are performed.
      </el-alert>
      <SettingItem
        v-for="store in storeList"
        :key="store.name"
        :label="store.name"
        :content="`${store.store.total.toLocaleString('en-US')} records in the local snapshot.`"
      />
      <SettingItem
        label="Rebuild local database"
        content="Restore areas, categories, items, icons, and markers from the bundled JSON snapshot."
      >
        <el-button type="danger" :icon="WarnTriangleFilled" @click="resetDatabase">
          Rebuild from snapshot
        </el-button>
      </SettingItem>
    </div>
  </el-scrollbar>
</template>

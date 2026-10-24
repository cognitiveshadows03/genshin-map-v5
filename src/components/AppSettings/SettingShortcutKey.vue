<script lang="ts" setup>
import SettingItem from './SettingItem.vue'
</script>

<template>
  <el-scrollbar>
    <div class="flex flex-col">
      <SettingItem label="Keyboard shortcuts" content="Additional map shortcuts are not currently configurable." />
      <SettingItem label="Toggle sidebar" content="Press the backquote key (`) to show or hide the map sidebar." />
    </div>
  </el-scrollbar>
</template>

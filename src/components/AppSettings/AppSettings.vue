<script lang="ts" setup>
import { SettingCommon, SettingDatabase, SettingShortcutKey } from '.'

const activeName = ref('common')
</script>

<template>
  <div class="setting-panel p-4 flex flex-col gap-2">
    <el-alert type="info" center :closable="false">
      Settings, filters, and completion progress are stored locally on this device.
    </el-alert>

    <el-tabs v-model="activeName" type="border-card" class="setting-tabs">
      <el-tab-pane label="General" name="common" lazy>
        <SettingCommon />
      </el-tab-pane>

      <el-tab-pane label="Local Data" name="database" lazy>
        <SettingDatabase />
      </el-tab-pane>

      <el-tab-pane label="Shortcuts" name="shortcut-keys" lazy>
        <SettingShortcutKey />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style lang="scss" scoped>
.setting-panel {
  width: 600px;
  height: 60vh;
  @media screen and (width < 600px) {
    width: 100vw;
  }
  &:deep(.el-tabs) {
    display: flex;
    flex-direction: column;
  }
  :deep(.el-tabs__header) {
    .el-tabs__item {
      transition: none;
    }
  }
  :deep(.el-tabs__content) {
    flex: 1;
    overflow: hidden;
    .el-tab-pane {
      height: 100%;
      overflow: hidden;
    }
  }
}

.setting-tabs {
  border-radius: 4px;
  overflow: hidden;
  flex: 1;
  :deep(.el-tabs__content) {
    padding: 0;
  }
}
</style>

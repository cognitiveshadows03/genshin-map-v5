export interface GlobalSetting {
  /** 根据点位坐标将地图移动到点集中心 */
  moveToCenter: boolean
  /** 在筛选器满足条件时自动跳转到下一级 */
  autoTurnNext: boolean
  /** 是否开启点位 hover 反馈 */
  markerHoverFeedback: boolean
  /** @彩蛋 是否卡半岩 */
  waittingGeo: boolean
}

// Preferences are stored locally on this device.
export const localSettings = useLocalStorage<GlobalSetting>('__ys_global_settings', {
  moveToCenter: true,
  autoTurnNext: true,
  markerHoverFeedback: false,
  waittingGeo: false,
})

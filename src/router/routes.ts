import type { RouteRecordRaw } from 'vue-router'

// TODO: 后期按模块抽离或做动态化
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    meta: {
      title: 'Genshin Offline Map',
      icon: 'MapLocation',
    },
    component: () => import('@/pages/pageMapV2/PageMapV2.vue'),
  },
]

export default routes

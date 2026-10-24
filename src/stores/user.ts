import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import { messageFrom } from '@/utils'
import type { UserPreference } from '@/database/appdatabase'
import db from '@/database'

export interface LocalUserInfo {
  id: number
  username: string
  nickname: string
  logo: string
}

const localUserInfo = useLocalStorage<LocalUserInfo>('__ys_user_info', {
  id: 1,
  username: 'offline',
  nickname: 'Local User',
  logo: '',
})

/** A local-only identity used to key preferences. No authentication exists. */
export const useUserStore = defineStore('user-info', {
  state: () => ({
    info: localUserInfo.value,
    preference: {} as UserPreference,
    isHandling: false,
    isRouteLoading: false,
    isRouteAnimationEnd: true,
  }),
  getters: {
    showLoadingPanel: (state) => {
      return state.isHandling || state.isRouteLoading || !state.isRouteAnimationEnd
    },
  },
  actions: {
    async updateUserPreference() {
      this.preference = await db.user.get(1) ?? {}
    },
    async syncUserPreference() {
      try {
        await db.user.put({
          id: 1,
          ...JSON.parse(JSON.stringify(this.preference)),
        })
      }
      catch (error) {
        ElMessage.error(messageFrom(error))
      }
    },
  },
})

import type { NavigationGuardWithThis, Router } from 'vue-router'
import { useUserStore } from '@/stores'
import { Logger } from '@/utils'

const logger = new Logger('[beforeEachGuard]')

/** Single-route local navigation; no authentication or remote preload. */
export const beforeEachGuard = (router: Router): NavigationGuardWithThis<void> => {
  return async (to, from, next) => {
    Logger.group('[vue-router-process]')
    logger.info(`"${from.path}" => "${to.path}"`)
    if (!router.getRoutes().some(route => route.path === to.path))
      return next(new Error('The requested route does not exist'))

    const userStore = useUserStore()
    if (!userStore.preference.filterStates)
      await userStore.updateUserPreference()
    userStore.isRouteLoading = true
    next(true)
  }
}

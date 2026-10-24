import type { Ref } from 'vue'
import { messageFrom } from '@/utils'

export interface AsyncTaskOptions<T, A extends unknown[] = []> {
  loading?: Ref<boolean>
  immediate?: boolean
  task?: (...args: A) => Promise<T>
}

/** Shared loading and lifecycle events for local asynchronous tasks. */
export const useAsyncTask = <T, A extends unknown[] = []>(options: AsyncTaskOptions<T, A> = {}) => {
  const { immediate, loading = ref(false), task } = options

  const onSuccessHook = createEventHook<T>()
  const onErrorHook = createEventHook<Error>()
  const onFinishHook = createEventHook<void>()

  const refresh = async (...args: A) => {
    try {
      loading.value = true
      if (task) {
        const result = await task(...args)
        onSuccessHook.trigger(result)
      }
    }
    catch (error) {
      onErrorHook.trigger(error instanceof Error ? error : new Error(messageFrom(error)))
    }
    finally {
      loading.value = false
      onFinishHook.trigger()
    }
  }

  if (immediate)
    onMounted(refresh)

  return { loading, refresh, onSuccess: onSuccessHook.on, onError: onErrorHook.on, onFinish: onFinishHook.on }
}

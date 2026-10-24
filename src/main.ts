import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import en from 'element-plus/es/locale/lang/en'
import App from './App.vue'
import './style/app.scss'
import { router } from '@/router'
import { ElementIcons, customPaint } from '@/plugin'
import { bootstrapOffline, preloadTilePack } from '@/offline'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'

const start = async () => {
  const app = createApp(App)
  const pinia = createPinia()
  setActivePinia(pinia)
  app.use(pinia)

  // Fresh profiles are usable immediately: no account, API, cache warming,
  // or network connection is required to construct the local database.
  await Promise.all([
    bootstrapOffline(),
    preloadTilePack(),
  ])

  app
    .use(customPaint())
    .use(router)
    .use(ElementPlus, {
      locale: en,
    })
    .use(ElementIcons)
    .mount('#app')
}

start().catch((error) => {
  const app = document.getElementById('app')
  if (app)
    app.textContent = `Offline map initialization failed: ${error instanceof Error ? error.message : String(error)}`
  console.error(error)
})

import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import VueJsx from '@vitejs/plugin-vue-jsx'
import AutoImport from 'unplugin-auto-import/vite'
import { offlineBundle } from './plugins'

// Offline mode has no API schema generation, remote proxy, credential check,
// or runtime asset host. Everything is resolved from this repository/build.
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 9001,
    allowedHosts: ['.e2b.app'],
  },
  preview: {
    host: '0.0.0.0',
    port: 13101,
  },
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: `${resolve(__dirname, 'src')}/`,
      },
    ],
  },
  plugins: [
    Vue(),
    VueJsx(),
    AutoImport({
      imports: ['vue', '@vueuse/core', 'vue-router'],
      dts: './types/auto-imports.d.ts',
    }),
    offlineBundle(),
  ],
  build: {
    chunkSizeWarningLimit: 2000,
  },
})

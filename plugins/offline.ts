import type { Plugin } from 'vite'

const CSP = [
  'default-src \'self\'',
  'script-src \'self\' \'unsafe-inline\' \'wasm-unsafe-eval\' data: blob:',
  'style-src \'self\' \'unsafe-inline\'',
  'img-src \'self\' data: blob:',
  'font-src \'self\' data:',
  'connect-src \'self\' data: blob:',
  'worker-src \'self\' data: blob:',
  'child-src \'self\' data: blob:',
  'object-src \'none\'',
  'base-uri \'self\'',
  'form-action \'self\'',
].join('; ')

/**
 * Build-time offline guard. Runtime operation uses only the bundled static
 * files and deliberately does not depend on service-worker installation.
 */
export const offlineBundle = (): Plugin => ({
  name: 'offline-bundle',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: html => html.replace(
      '<head>',
      `<head>\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    ),
  },
})

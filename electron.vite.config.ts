import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Trois cibles de build :
 *  - main    → backend/main.ts       (process principal Node/Electron)
 *  - preload → backend/preload.ts    (pont sécurisé vers le frontend)
 *  - renderer→ frontend/index.html   (UI React)
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // Deux points d'entrée : l'application, et l'hôte lancé dans un process séparé pour
      // chaque plugin actif (voir backend/core/plugins/manager.ts).
      rollupOptions: {
        input: {
          main: resolve('backend/main.ts'),
          'plugin-host': resolve('backend/core/plugins/host.ts')
        },
        output: { entryFileNames: '[name].js' }
      }
    },
    resolve: { alias: { '@backend': resolve('backend'), '@shared': resolve('shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve('backend/preload.ts') } },
    resolve: { alias: { '@shared': resolve('shared') } }
  },
  renderer: {
    root: 'frontend',
    build: { rollupOptions: { input: resolve('frontend/index.html') } },
    resolve: { alias: { '@frontend': resolve('frontend/src'), '@shared': resolve('shared') } },
    plugins: [react()]
  }
})

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSheetsApiPlugin } from './server/viteSheetsApiPlugin.js'
import { viteTtsApiPlugin } from './server/viteTtsApiPlugin.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const serverEnv = loadEnv(mode, process.cwd(), '')

  Object.assign(process.env, serverEnv)

  return {
    plugins: [react(), viteSheetsApiPlugin(), viteTtsApiPlugin()],
    server: { watch: { ignored: ['**/mediweb-downloader/build-windows/**', '**/mediweb-downloader/dist-windows/**'] } },
  }
})

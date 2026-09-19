import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, loadEnv } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss'

const workspaceDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ envMode }) => {
  const env = loadEnv({ mode: envMode, prefixes: ['VITE_'] })
  const serverUrl =
    process.env.VITE_REACT_APP_SERVER_URL ||
    env.rawPublicVars.VITE_REACT_APP_SERVER_URL ||
    'http://localhost:3000'

  return {
    plugins: [pluginReact(), pluginTailwindcss({ optimize: false })],
    source: {
      entry: { index: './src/main.tsx' },
    },
    resolve: {
      alias: { '@': path.resolve(workspaceDir, './src') },
    },
    html: {
      template: './index.html',
    },
    server: {
      host: '0.0.0.0',
      port: 5174,
      strictPort: false,
      proxy: Object.fromEntries(
        ['/api', '/v1', '/mj', '/pg'].map((prefix) => [
          prefix,
          { target: serverUrl, changeOrigin: true },
        ])
      ),
    },
    output: {
      target: 'web',
      distPath: { root: 'dist' },
    },
  }
})

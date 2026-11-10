import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Desenvolvimento só da interface no navegador, sem Electron (usa src/renderer/src/mockApi.ts).
export default defineConfig({
  root: resolve('src/renderer'),
  resolve: { alias: { '@shared': resolve('src/shared') } },
  plugins: [react(), tailwindcss()],
  server: { port: 5174, open: true }
})

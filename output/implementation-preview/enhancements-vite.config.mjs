import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({ root: resolve(import.meta.dirname, '../..'), plugins: [react()], resolve: { alias: { '@shared': resolve(import.meta.dirname, '../../src/shared') } }, server: { host: '127.0.0.1', port: 4327, strictPort: true, watch: { ignored: ['**/output/playwright/**'] } } })

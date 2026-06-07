import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    command === 'serve' && {
      name: 'dev-title',
      transformIndexHtml: html => html.replace('<title>Cuebey</title>', '<title>Cuebey Dev</title>'),
    },
  ],
}))

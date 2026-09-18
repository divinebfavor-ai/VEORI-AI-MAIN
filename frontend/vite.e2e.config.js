// Temporary: serves the real UI locally against production's API so the browser
// exercises exactly what an operator sees. Removed after the check.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'https://veori.net',
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('origin'); proxyReq.removeHeader('referer') })
        },
      },
    },
  },
})

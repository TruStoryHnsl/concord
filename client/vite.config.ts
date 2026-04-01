import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Production build config — no dev server, no proxies, no SSL plugin.
// Nginx handles all routing in production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: true,
    hmr: {
      // HMR connects back through the same host the page was loaded from
      clientPort: 443,
      protocol: 'wss',
    },
  },
})

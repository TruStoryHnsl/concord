import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Production build config — no dev server, no proxies, no SSL plugin.
// Nginx handles all routing in production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  base: '/rp2040_web_flasher/',
  plugins: [
    react(),
    {
      name: 'development-csp',
      apply: 'serve',
      // Vite's dev-only inline refresh script and WebSocket need a relaxed policy.
      // The built artifact retains the strict, self-hosted policy in index.html.
      transformIndexHtml: html => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
    },
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})

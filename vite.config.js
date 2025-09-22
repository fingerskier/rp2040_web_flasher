import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  base: '/rp2040_web_flasher',
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})

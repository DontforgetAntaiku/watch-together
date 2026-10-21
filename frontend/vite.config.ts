import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 700 }, // hls.js is a lazy chunk, loaded only for .m3u8 links
  define: {
    'import.meta.env.VITE_DEBUG': JSON.stringify(process.env.FRONTEND_DEBUG ?? 'True'),
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT ?? '8000'}`,
        changeOrigin: false,
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  // The 'base' property is for the production build, so that asset paths
  // are correct when served from a subdirectory. This is correct for your server setup.
  base: '/money/',
  plugins: [react(),tailwindcss()],

  // The 'server' block configures the Vite development server ONLY.
  // It has no effect on your production build.
  server: {
    proxy: {
      // This rule says: if a request comes in to the dev server that starts
      // with '/api/money', forward it to your backend server on port 4000.
      '/api/money': {
        target: 'http://localhost:4000',
        changeOrigin: true, // Recommended for virtual hosts
        secure: false,      // Recommended if your backend is not running HTTPS
      }
    }
  }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset URLs so the production build also loads inside the desktop shell.
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    watch: { ignored: ['**/release/**', '**/dist/**', '**/artifacts/**'] },
  },
})

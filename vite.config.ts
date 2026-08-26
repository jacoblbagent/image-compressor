import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  // Subpath for GitHub Pages project URL; root for local dev.
  base: process.env.GH_PAGES ? '/image-compressor/' : '/',
  plugins: [react()],
});

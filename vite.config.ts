import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves this repository from /open-karaoke/ instead of /.
  base: process.env.GITHUB_ACTIONS ? '/open-karaoke/' : '/',
  server: {
    host: 'localhost',
    port: 5173,
  },
});

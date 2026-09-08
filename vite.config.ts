import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves this repository from /open-karaoke/ instead of /.
  base: process.env.GITHUB_ACTIONS ? '/open-karaoke/' : '/',
  server: {
    host: 'localhost',
    port: 5173,
  },
});

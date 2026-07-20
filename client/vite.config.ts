import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
      },
      '/auth': {
        target: 'http://localhost:8787',
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});

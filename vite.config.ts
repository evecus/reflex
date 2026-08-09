import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 产物用相对路径，使 dist 可直接被 reflex external_ui 在 /ui/* 下服务
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
  },
});

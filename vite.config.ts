import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Native fs.watch is unreliable for repositories inside OneDrive on Windows.
    // Poll source files instead and exclude generated media from the watcher.
    watch: {
      usePolling: true,
      interval: 300,
      ignored: ['**/workdir/**', '**/dist/**'],
    },
    proxy: { '/api': 'http://localhost:8787' },
  },
});

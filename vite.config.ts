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
    // Backend binds explicitly to IPv4; using 127.0.0.1 avoids Node trying ::1 first and logging noisy ECONNREFUSED/AggregateError during dev startup.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});

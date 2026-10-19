import { defineConfig } from 'vite';

// PINPIN II — build config.
// Everything is client-side: the "server" is a player's browser (PeerJS WebRTC mesh),
// so GitHub Pages can host the static build without any backend.
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
});

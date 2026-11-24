import { defineConfig } from 'vite';

export default defineConfig({
  // `--host` lets you open the dev server from a phone on the same Wi-Fi.
  // The lobbies live in the Worker: run `npm run dev:worker` alongside
  // `npm run dev`, and /api (including the WebSockets) is proxied to it.
  server: {
    host: true,
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
  build: { target: 'es2020' },
});

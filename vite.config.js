import { defineConfig } from 'vite';
import { attachMultiplayer } from './server/multiplayer.js';

// `npm run dev` also runs the multiplayer socket (/ws) so you can test with several browser tabs.
const multiplayer = () => ({
  name: 'farm-multiplayer',
  configureServer(server) { if (server.httpServer) attachMultiplayer(server.httpServer); },
  configurePreviewServer(server) { if (server.httpServer) attachMultiplayer(server.httpServer); },
});

export default defineConfig({ base: './', plugins: [multiplayer()], build: { chunkSizeWarningLimit: 1500 } });

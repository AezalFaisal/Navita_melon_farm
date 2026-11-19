// Production server: serves the built website (./dist) AND the realtime multiplayer socket (/ws) on one port.
//   npm run build && npm start         -> http://localhost:3000
// Hosting (Render / Railway / Fly / any Node host): build command `npm install && npm run build`, start command `npm start`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachMultiplayer } from './multiplayer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('dist/index.html not found - run `npm run build` first.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }      // no path traversal
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'content-length': st.size };
    headers['cache-control'] = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
});

attachMultiplayer(server);
server.listen(PORT, () => console.log(`Navita Melon Farm running on http://localhost:${PORT}  (multiplayer socket: /ws)`));

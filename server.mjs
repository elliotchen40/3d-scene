// Static file server for the 3d-scene collection.
//   node server.mjs            → http://localhost:8002
//   PORT=9000 node server.mjs  → http://localhost:9000
//
// The three scenes are plain static bundles, so any static host works
// (GitHub Pages, Netlify, nginx). This server exists only for local preview.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8002);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.srt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }

  let rel = pathname.replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';

  // Serve the shared favicon for every page that does not declare its own.
  if (rel === 'favicon.ico') rel = 'favicon.svg';

  const file = path.join(ROOT, rel);
  // Reject anything that escapes the served root.
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }

  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`3d-scene preview → http://localhost:${PORT}`);
  console.log(`  hub:    http://localhost:${PORT}/`);
  console.log(`  sidi:   http://localhost:${PORT}/scenes/sidi-bou-said/index.html`);
  console.log(`  forest: http://localhost:${PORT}/scenes/forest/index.html`);
  console.log(`  veilspire: http://localhost:${PORT}/scenes/veilspire/index.html`);
});

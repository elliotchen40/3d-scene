// Static file server for the 3d-scene collection.
//   node server.mjs            → http://localhost:8002
//   PORT=9000 node server.mjs  → http://localhost:9000
//
// The three scenes are plain static bundles, so any static host works
// (GitHub Pages, Netlify, nginx). This server exists only for local preview.
//
// The scenes/nature/ projects are Vite builds with base './', so they resolve
// their assets relative to their own directory and work under any mount path
// (including GitHub Pages' /<repo>/ sub-path).
//
// Optional TLS listener (for phones on the LAN, which need a secure context
// for WebGPU):
//   TLS_CERT=cert.pem TLS_KEY=key.pem TLS_PORT=8004 node server.mjs
//   HTTPS_PUBLIC_PORT=19406 node server.mjs   # host-visible port of the TLS listener

import http from 'node:http';
import https from 'node:https';
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

// Abyssal Garden needs WebGPU, and browsers only expose it in a secure context
// (https:// or localhost). Reached over plain http:// from a LAN or Tailscale
// address the page would fail with "This scene needs a secure connection", so
// bounce those requests to an https:// address instead.
//
// HTTPS_PUBLIC_PORT: the host-visible port of the TLS listener (the container
//   maps 8003->19405 and 8004->19406, so 19406 here). When it is set, the
//   redirect keeps the hostname the visitor typed and only swaps the scheme
//   and port, so a Tailscale address stays a Tailscale address and a LAN
//   address stays a LAN address.
//   When it is not set, the public GitHub Pages deployment is used.
const HTTPS_PUBLIC_PORT = process.env.HTTPS_PUBLIC_PORT;
const ABYSSAL_HTTPS = 'https://elliotchen40.github.io/3d-scene/scenes/abyssal-garden/index.html';

const handler = (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }

  const host = (req.headers.host || '').toLowerCase();
  const loopback = !host || host.includes('localhost') || host.startsWith('127.') || host.startsWith('[::1]');
  const proxied = (req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  const secure = req.socket.encrypted === true;
  if (!secure && !loopback && !proxied && pathname.startsWith('/scenes/abyssal-garden/')) {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    let target = ABYSSAL_HTTPS;
    if (HTTPS_PUBLIC_PORT) {
      const hostname = host.replace(/:\d+$/, '') || 'localhost';
      target = `https://${hostname}:${HTTPS_PUBLIC_PORT}${pathname}${q}`;
    }
    res.writeHead(302, { Location: target, 'Cache-Control': 'no-cache' });
    res.end();
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
};

const server = http.createServer(handler);

// Optional TLS listener: TLS_CERT + TLS_KEY turn this into an https server,
// which is what a phone on the LAN needs for WebGPU (secure context).
const TLS_CERT = process.env.TLS_CERT, TLS_KEY = process.env.TLS_KEY;
if (TLS_CERT && TLS_KEY) {
  const sport = Number(process.env.TLS_PORT || PORT + 1);
  https.createServer(
    { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) },
    handler,
  ).listen(sport, '0.0.0.0', () => {
    console.log(`3d-scene preview (https) → https://localhost:${sport}`);
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`3d-scene preview → http://localhost:${PORT}`);
  console.log(`  hub:    http://localhost:${PORT}/`);
  console.log(`  sidi:   http://localhost:${PORT}/scenes/sidi-bou-said/index.html`);
  console.log(`  forest: http://localhost:${PORT}/scenes/forest/index.html`);
  console.log(`  veilspire: http://localhost:${PORT}/scenes/veilspire/index.html`);
  console.log(`  nature:    http://localhost:${PORT}/scenes/nature/`);
  console.log(`  abyssal:   http://localhost:${PORT}/scenes/abyssal-garden/index.html`);
});

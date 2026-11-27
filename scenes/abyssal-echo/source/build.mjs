// Bundles the Abyssal Garden engine with the Abyssal Echo game layer into a
// single self-contained ../index.html.
//
// The engine sources are shared with the abyssal-garden scene, so the upstream
// code lives in exactly one place. This script patches two hooks into main.js
// and appends the game's own module:
//   1. GAME.tick()  once per frame, just before the scene is drawn
//   2. GAME.draw(r) inside the scene render pass, so the light cores are drawn
//      with the terrain: depth tested, into the HDR target, and into the bloom
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(here, '..', '..', 'abyssal-garden', 'source', 'src');
const FILES = ['quality.js', 'math.js', 'shaders.js', 'world.js', 'main.js', 'audio.js'];
const readable = process.argv.includes('--readable');

// the engine, with the two hooks the game needs
let js = FILES.map((f) => {
  let src = readFileSync(path.join(ENGINE, f), 'utf8');
  if (f === 'main.js') {
    // the frame loop: give the game a tick before the scene is drawn
    const before = '    collide();\n  }\n  render();';
    const after = '    collide();\n  }\n  if (GAME) GAME.tick();\n  render();';
    if (src.split(before).length !== 2) throw new Error('engine changed: frame hook anchor not found exactly once');
    src = src.replace(before, after);
    // the scene pass: draw the light cores with the terrain
    const scene = '  r.setPipeline(pSnow); r.setVertexBuffer(0, ibSnowB); r.draw(4, nSnow);\n  r.end();';
    const sceneHook = '  r.setPipeline(pSnow); r.setVertexBuffer(0, ibSnowB); r.draw(4, nSnow);\n  if (GAME) GAME.draw(r);\n  r.end();';
    if (src.split(scene).length !== 2) throw new Error('engine changed: scene hook anchor not found exactly once');
    src = src.replace(scene, sceneHook);
  }
  return src;
}).join('\n');

// the game's own module, last so it can see everything the engine defines
js += '\n' + readFileSync(path.join(here, 'src', 'game.js'), 'utf8');

const tpl = readFileSync(path.join(here, 'template.html'), 'utf8');
// everything runs inside one async function; startup errors are shown on screen
const wrap = (body) => `(async()=>{${body}\n})().catch(e=>{console.error(e);document.body.className='l e';document.getElementById('s').textContent=(e.cause?'':'Failed to start: ')+e.message});`;

let html;
if (readable) {
  html = tpl.replace('/*SCRIPT*/', () => wrap(js));
} else {
  // shrink the WGSL inside /*wgsl*/ template literals, then minify the JS and the page's CSS
  const minWgsl = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').replace(/ ?([{}()\[\];,:=+\-*\/<>&|!%@]) ?/g, '$1').trim();
  js = js.replace(/\/\*wgsl\*\/`([^`]*)`/g, (_, w) => '`' + minWgsl(w) + '`');
  const code = transformSync(wrap(js), { minify: true, target: 'es2022', legalComments: 'none' }).code.trim();
  const css = (_, s) => '<style>' + transformSync(s, { loader: 'css', minify: true }).code.trim();
  html = tpl.replace(/<style>([^]*?)(?=<\/style>)/, css).replace(/>\s+</g, '><').replace('/*SCRIPT*/', () => code).replace(/<script>\s+/, '<script>').replace(/\s+<\/script>/, '</script>');
}
writeFileSync(path.join(here, '..', 'index.html'), html);
const gz = gzipSync(Buffer.from(html), { level: 9 }).length;
console.log(`index.html: ${(html.length / 1024).toFixed(1)} kB${readable ? ' (readable)' : ''}, ${(gz / 1024).toFixed(1)} kB gzipped`);

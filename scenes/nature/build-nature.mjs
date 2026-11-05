#!/usr/bin/env node
/**
 * 为 scenes/nature 下的 9 个项目做「静态托管友好」的构建。
 *
 * 背景：这些上游项目大量用**根绝对路径**（/map/... /Material_1/... /assets/...），
 * 在 GitHub Pages 这种「挂在 /<repo>/ 子路径」下会 404 —— 而且 <base href>
 * 对根绝对路径**无效**（实测 /map/day/px.png 仍解析到站点根）。
 *
 * 做法：
 *   1. 把根绝对路径改成相对路径（'./map/...'），这样任何挂载前缀下都能解析。
 *   2. vite 构建时 base: './'，产物里的 /assets/xxx.js 也变成 ./assets/xxx.js。
 *   3. 源码保留在 <slug>/source/（与仓库里 veilspire 的约定一致），
 *      构建产物放在 <slug>/ 根，部署只需要根目录。
 *
 * 用法：node build-nature.mjs [slug...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** slug -> { title, vite: 是否走 vite 构建, srcEntry } */
const PROJECTS = {
  'elemental-serenity': { title: 'Elemental Serenity', vite: true },
  'small-world': { title: 'small-world', vite: true },
  'water': { title: 'WaterThreeJS', vite: true },
  'ocean': { title: 'OceanThreejs', vite: true },
  'grass': { title: 'GrassSystemThreeJS', vite: true },
  'snow': { title: 'SnowSystemThreeJS', vite: true },
  'rain': { title: 'RainSystemThreeJS', vite: true },
  'vegetation': { title: 'VegetationGeneratorThreeJS', vite: true },
  'jungle-trail': { title: 'jungle-trail', vite: false }, // 纯静态 ES module，无构建
};

/**
 * 把根绝对路径改成相对路径。
 * 只处理「以 / 开头且不是 // 协议相对」的字符串字面量，
 * 替换成 './' + 原路径。
 */
function relativize(dir, file) {
  const f = path.join(dir, file);
  if (!fs.existsSync(f)) return { changed: 0 };
  const before = fs.readFileSync(f, 'utf8');
  let count = 0;

  const after = before
    // '/foo/bar' -> './foo/bar'   （保留原引号）
    .replace(/(["'`])\/([A-Za-z0-9_][A-Za-z0-9_.\-/]*)\1/g, (m, q, p) => {
      // 跳过已知不该改的：协议相对 URL、绝对 URL 片段
      if (p.startsWith('//')) return m;
      count++;
      return `${q}./${p}${q}`;
    })
    // 反引号模板里的 ${} 也一并处理
    .replace(/`\.\/([^`]*\$\{[^`]*)/g, (m) => m); // 已在上面处理，保持不变

  if (after !== before) {
    fs.writeFileSync(f, after);
  }
  return { changed: count };
}

/** 递归扫描源文件，做根绝对路径 → 相对路径 */
function relativizeAll(srcDir) {
  const exts = new Set(['.js', '.ts', '.html', '.mjs', '.json']);
  let total = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!exts.has(path.extname(e.name))) continue;
      total += relativize(d, e.name).changed;
    }
  };
  walk(srcDir);
  return total;
}

/** 给 vite config 加/改 base: './' */
function patchViteBase(srcDir) {
  for (const name of ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']) {
    const f = path.join(srcDir, name);
    if (!fs.existsSync(f)) continue;
    let s = fs.readFileSync(f, 'utf8');
    if (/base\s*:/.test(s)) {
      s = s.replace(/base\s*:\s*['"][^'"]*['"]/, "base: './'");
    } else if (/defineConfig\(\s*\{/.test(s)) {
      // defineConfig({ ... }) —— 插到 defineConfig( 后面
      s = s.replace(/(defineConfig\(\s*\{)/, "$1\n  base: './',");
    } else if (/export\s+default\s*\{/.test(s)) {
      s = s.replace(/export\s+default\s*\{/, "export default {\n  base: './',");
    } else if (/export\s+default\s+defineConfig/.test(s)) {
      // export default defineConfig({...}) —— 已被上面的 defineConfig( 分支覆盖
    } else {
      // 兜底：新建一个 config
      fs.writeFileSync(f, "export default { base: './' };\n");
      return name + ' (新建)';
    }
    fs.writeFileSync(f, s);
    return name;
  }
  return null;
}

const only = process.argv.slice(2);
const targets = Object.keys(PROJECTS).filter((s) => !only.length || only.includes(s));

for (const slug of targets) {
  const proj = PROJECTS[slug];
  const dir = path.join(ROOT, slug);
  const src = path.join(dir, 'source');

  console.log(`\n=== ${slug} (${proj.title}) ===`);

  // 1) 源码搬到 source/
  if (!fs.existsSync(src)) {
    const stash = path.join(dir, '.stash-src');
    if (fs.existsSync(stash)) fs.renameSync(stash, src);
    else {
      // 第一次跑：把除 LICENSE/README 之外的东西整体搬进 source/
      const tmp = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'LICENSE' || e.name === 'README.md') continue;
        tmp.push(e.name);
      }
      fs.mkdirSync(src, { recursive: true });
      for (const n of tmp) {
        fs.renameSync(path.join(dir, n), path.join(src, n));
      }
    }
  }

  // 2) 根绝对路径 → 相对路径
  const n = relativizeAll(src);
  console.log(`  相对路径改写: ${n} 处`);

  // 3) vite base
  if (proj.vite) {
    const cfg = patchViteBase(src);
    console.log(`  vite base: './' ${cfg ? '→ ' + cfg : '(无 config，需手改)'}`);
  }

  // 4) 构建
  if (proj.vite) {
    try {
      execSync('npm install --include=dev --no-audit --no-fund', {
        cwd: src, stdio: 'pipe', timeout: 600000,
      });
      execSync('npm run build', { cwd: src, stdio: 'pipe', timeout: 600000 });
      // dist/* 提到 slug 根
      const dist = path.join(src, 'dist');
      if (fs.existsSync(dist)) {
        for (const e of fs.readdirSync(dist, { withFileTypes: true })) {
          const from = path.join(dist, e.name);
          const to = path.join(dir, e.name);
          fs.rmSync(to, { recursive: true, force: true });
          fs.renameSync(from, to);
        }
        fs.rmSync(dist, { recursive: true, force: true });
      }
      console.log('  构建 OK');
    } catch (e) {
      const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
      console.log('  构建 FAILED\n' + out.split('\n').slice(-12).join('\n'));
    }
  } else {
    // 纯静态项目：把源码直接放回 slug 根（index.html + src/ + public/）
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const from = path.join(src, e.name);
      const to = path.join(dir, e.name);
      if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
      fs.renameSync(from, to);
    }
    fs.rmSync(src, { recursive: true, force: true });
    console.log('  纯静态，无需构建');
  }
}

console.log('\n完成。');

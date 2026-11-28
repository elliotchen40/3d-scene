// ============================================================================
// quality level, chosen before anything is built
// ============================================================================
// LV: 0 High, 1 Medium, 2 Low. Medium and Low keep every 2nd / 4th leaf, glint and pebble and bake fewer shadows;
// Low also drops anti-aliasing and uses coarser meshes, cheaper filtering and fewer light shaft steps.
// localStorage.abyssal = "level,pixels,detail". abyssalLoad is set while the world is built: still set on the next
// visit means that load crashed the tab, so this one runs a level lower.
// An iPad is not a desktop, whatever the pointer says: iPadOS 13+ in desktop mode
// sends a desktop UA, and a mouse attached to an iPad makes (pointer:coarse) stop
// matching. Either way the iPad would be taken for a desktop — pointer lock, no
// on-screen ping button, a 2560x1440 target at 4x MSAA on what may be an old A10. An
// iPad always reports more than one touch point, so ask the device, not the pointer.
// A Windows touch laptop keeps pointer:coarse, and its platform is not MacIntel,
// so it is left as it was.
const tcap = navigator.maxTouchPoints > 1;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && tcap);
const mob = matchMedia('(pointer:coarse)').matches || ios;
// Safari does not implement navigator.deviceMemory at all (MDN BCD says
// version_added false for both safari and safari_ios), so mem is undefined there
// and `mem > 7` and `mem <= 4` are both false — every desktop Safari landed on
// High (4096 shadow map, 4x MSAA, a 2560x1440 target) and every phone on Low, no
// matter the hardware. The core count is the only hint left: Safari clamps
// hardwareConcurrency to 4 or 8, so 8 means a recent chip that can afford Medium
// or High and 4 means an older one that should stay Low. On a phone that is the
// safe side, and a device that cannot hold the level loses its GPU and reloads
// one level lower (see the device-lost handler in main.js).
const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency || 4;
const ram = mem !== undefined ? mem : (cores >= 8 ? 8 : 4);
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage.abyssal || '').split(','); bad = localStorage.abyssalLoad; } catch {}
LV = SV[0] ? +SV[0] : mob ? (ram > 7 ? 1 : 2) : ram <= 4 ? 2 : 0;
if (bad && LV < 2) { SV = [++LV]; keep('abyssal', LV); }
const THIN = 1 << LV, SHADOW = LV ? 2048 : 4096, AA = LV > 1 ? 1 : 4, WATER = LV > 1 ? 256 : 512, RAYN = LV > 1 ? 12 : 34;

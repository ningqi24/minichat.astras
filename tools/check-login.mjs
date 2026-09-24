// ==========================================================================
// 登录页自检
//
//   node tools/check-login.mjs
//
// 检查项：
//   1. js/login.js 是否与 js/app.js 同步（指纹比对）—— 防止"改了一边忘另一边"
//   2. 登录页所有 data-i18n* 的键在 login.js 的字典里都存在
//   3. 登录页的资源引用是否都是绝对路径（子目录页面用相对路径会 404）
//   4. 登录页上每个可交互元素是否都有监听器
//   5. 版本号 7 处是否一致
//
// 退出码：0 = 全过，1 = 有失败项（方便接 CI）
// ==========================================================================
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

const app = read('js/app.js');
const loginJs = read('js/login.js');
const loginHtml = read('login/index.html');
const indexHtml = read('index.html');
const sw = read('sw.js');
const vision = read('data/vision.json');
const bindings = readFileSync(join(HERE, 'login-page-bindings.js'), 'utf8');

// 去掉 HTML 注释（注释里的示例文本会干扰扫描，比如 favicon 那段说明里的 "?v=2"）
const htmlNoComments = loginHtml.replace(/<!--[\s\S]*?-->/g, '');

let failed = 0;
const ok = (label, extra = '') => console.log(`  ✅ ${label}${extra ? '  ' + extra : ''}`);
const bad = (label, extra = '') => { failed++; console.log(`  ❌ ${label}${extra ? '  ' + extra : ''}`); };

function matchBrace(src, openIdx) {
  let d = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return i; }
  }
  return -1;
}

// ---- 1. 与 app.js 的同步性 ----
console.log('\n[1] 与 js/app.js 的同步性');
try {
  const I18N_START = app.indexOf('var i18n = {');
  const head = app.slice(0, I18N_START);
  const dictOpen = app.indexOf('{', I18N_START);
  const dictClose = matchBrace(app, dictOpen);
  const dict = runInNewContext('(' + app.slice(dictOpen, dictClose + 1) + ')');
  const need = new Set();
  for (const m of htmlNoComments.matchAll(/data-i18n(?:-html|-placeholder)?="([^"]+)"/g)) need.add(m[1]);
  for (const m of head.matchAll(/\bt\(['"]([A-Za-z0-9_]+)['"]\)/g)) need.add(m[1]);
  const keptKeys = Object.keys(dict.zh).filter(k => need.has(k));
  const extractFunction = (src, name) => {
    const idx = src.indexOf('function ' + name + '(');
    const open = src.indexOf('{', idx);
    return src.slice(idx, matchBrace(src, open) + 1);
  };
  const helpers = ['getCurrentLang', 't', 'loadLanguage'].map(n => extractFunction(app, n)).join('\n');
  const fingerprint = createHash('sha256')
    .update(head).update('\u0000').update(keptKeys.join(',')).update('\u0000').update(helpers).update('\u0000').update(bindings)
    .digest('hex');
  const manifest = JSON.parse(readFileSync(join(HERE, 'login-build-manifest.json'), 'utf8'));
  if (fingerprint === manifest.fingerprint) {
    ok('js/login.js 与 js/app.js 同步', `指纹 ${fingerprint.slice(0, 12)}…`);
  } else {
    bad('js/login.js 已经和 js/app.js 不一致了');
    console.log('     修：node tools/build-login.mjs');
  }
} catch (e) {
  bad('同步性检查自身出错', e.message);
}

// ---- 2. i18n 完整性 ----
console.log('\n[2] i18n 字典完整性');
{
  const m = loginJs.match(/var i18n = \{[\s\S]*?\n\};/);
  if (!m) bad('在 js/login.js 里找不到 i18n 字典');
  else {
    const dict = runInNewContext('(' + m[0].replace('var i18n = ', '').replace(/;$/, '') + ')');
    const missing = [];
    for (const mm of htmlNoComments.matchAll(/data-i18n(?:-html|-placeholder)?="([^"]+)"/g)) {
      if (!dict.zh[mm[1]]) missing.push(mm[1]);
    }
    if (missing.length) bad(`缺少 ${missing.length} 个键`, missing.slice(0, 8).join(', '));
    else ok(`登录页用到的 data-i18n 键都在（共 ${Object.keys(dict.zh).length} 个键）`);
  }
}

// ---- 3. 资源引用必须是绝对路径 ----
console.log('\n[3] 资源引用');
{
  const offenders = [];
  for (const mm of htmlNoComments.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const v = mm[1];
    if (v.startsWith('#') || v.startsWith('http') || v.startsWith('//') || v.startsWith('/')) continue;
    offenders.push(v);
  }
  if (offenders.length) bad(`${offenders.length} 处相对路径（子目录下会 404）`, offenders.join(', '));
  else ok('所有资源引用都已绝对化');
}

// ---- 4. 可交互元素是否都有监听器 ----
// 注意：绑定不一定写成 document.getElementById('x').addEventListener(...)，
// 也可能是 var y = $safe('x') / document.getElementById('x') 之后再 y.addEventListener(...)，
// 或者用 onclick = 。这里先把别名解析出来，再按别名去找绑定。
console.log('\n[4] 可交互元素的监听器覆盖');
{
  const code = loginJs + '\n' + bindings;
  // 别名表：id -> [变量名...]
  const alias = new Map();
  for (const m of code.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:document\.getElementById|\$safe)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const [, v, id] = m;
    if (!alias.has(id)) alias.set(id, []);
    alias.get(id).push(v);
  }
  const isBound = (id) => {
    const names = [id, ...(alias.get(id) || [])];
    for (const n of names) {
      // 变量名/字面量后面跟着 addEventListener，以及 onclick =
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${esc}\\b[^;]*?addEventListener\\(`).test(code)) return true;
      if (new RegExp(`\\b${esc}\\b[^;]*?\\.onclick\\s*=`).test(code)) return true;
    }
    return false;
  };
  // 只有"点得动"的元素才需要监听器：
  //   · button 一律算
  //   · a / span / div 只有在显式声明了 role="button" 或 tabindex 时才算
  //   （div#splash、span#authTitle 这类是纯容器，本来就不该有监听器）
  const elements = [];
  for (const m of htmlNoComments.matchAll(/<(button|a|span|div)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
    const tag = m[1];
    const attrs = (m[2] || '') + (m[4] || '');
    if (tag === 'button' || /role="button"/.test(attrs) || /tabindex=/.test(attrs)) {
      elements.push({ tag, id: m[3] });
    }
  }
  const unbound = elements.filter(e => !isBound(e.id)).map(e => e.tag + '#' + e.id);
  if (unbound.length) bad(`${unbound.length} 个元素没有绑定`, unbound.join(', '));
  else ok(`${elements.length} 个可交互元素都有绑定`);
}

// ---- 5. 版本号一致性 ----
console.log('\n[5] 版本号一致性');
{
  const vApp = (app.match(/var APP_VERSION = '([^']+)'/) || [])[1];
  const vLogin = (loginJs.match(/var APP_VERSION = '([^']+)'/) || [])[1];
  const vVision = (vision.match(/"version"\s*:\s*"([^"]+)"/) || [])[1];
  const vMetaIdx = (indexHtml.match(/name="version" content="([^"]+)"/) || [])[1];
  const vMetaLogin = (loginHtml.match(/name="version" content="([^"]+)"/) || [])[1];
  const rows = [
    ['js/app.js        APP_VERSION', vApp],
    ['js/login.js      APP_VERSION', vLogin],
    ['data/vision.json version', vVision],
    ['index.html       meta', vMetaIdx],
    ['login/index.html meta', vMetaLogin],
  ];
  let mismatch = false;
  for (const [n, v] of rows) if (v !== vApp) { mismatch = true; bad(n, `${v} ≠ ${vApp}`); }
  const qs = [...new Set([...htmlNoComments.matchAll(/\?v=([0-9.]+)/g)].map(x => x[1]))];
  const qs2 = [...new Set([...indexHtml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\?v=([0-9.]+)/g)].map(x => x[1]))];
  if (qs.some(v => v !== vApp) || qs2.some(v => v !== vApp)) { mismatch = true; bad('资源缓存串 ?v=', [...qs, ...qs2].join(', ')); }
  if (!mismatch) ok(`五处版本号 + 两页资源缓存串一致（${vApp}）`);
  const m = sw.match(/CACHE_NAME = '([^']+)'/);
  console.log(`  ℹ️  sw.js CACHE_NAME = ${m ? m[1] : '?'}（改版本号时记得 +1）`);
}

console.log('');
if (failed) {
  console.log(`\n❌ 有 ${failed} 项未通过\n`);
  process.exit(1);
} else {
  console.log('\n✅ 全部通过\n');
}

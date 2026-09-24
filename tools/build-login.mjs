// ==========================================================================
// 从 js/app.js 生成 js/login.js
//
//   node tools/build-login.mjs
//
// 为什么要脚本化 —— 因为这个文件原先是我手工裁剪出来的一次性快照，
// 结果已经漂移过好几次，每次都表现为登录页某个功能默默失效：
//
//   ① 变量声明没带过来（authToggle / togglePwd）→ if (未声明变量) 抛 ReferenceError，整页脚本挂掉
//   ② lib/supabase.min.js 还是相对路径 → /login/ 下 404 → supabase 未定义 → 整页脚本挂掉，卡在启动画面
//   ③ 事件绑定没带过来（switchFloxChat / floxBack）→ 点「使用 FloxChat 登录」没反应
//   ④ 眼睛按钮的图标切换没带过来 → 图标永远不变
//   ⑤ app.js 改了、login.js 没跟上（allMembersNum / 聊天页 boot 逻辑）
//
// 生成方式：登录相关代码【逐字取自 app.js】，不做任何改写；
//          唯一"裁剪"的是 i18n 字典（按实际用到的键）。
// ==========================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const APP = join(ROOT, 'js/app.js');
const LOGIN = join(ROOT, 'js/login.js');
const LOGIN_HTML = join(ROOT, 'login/index.html');
const BINDINGS = join(HERE, 'login-page-bindings.js');
const MANIFEST = join(HERE, 'login-build-manifest.json');

const app = readFileSync(APP, 'utf8');

// ---- 1. 头部：app.js 开头到 i18n 字典之前 ----
const I18N_START = app.indexOf('var i18n = {');
if (I18N_START < 0) throw new Error('在 js/app.js 里找不到 "var i18n = {"');
const head = app.slice(0, I18N_START);

// ---- 2. 解析并裁剪 i18n 字典 ----
function matchBrace(src, openIdx) {
  let d = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return i; }
  }
  return -1;
}
const dictOpen = app.indexOf('{', I18N_START);
const dictClose = matchBrace(app, dictOpen);
const dictSrc = app.slice(dictOpen, dictClose + 1);

// 用 vm 求值（app.js 里 i18n 是纯字面量，没有外部依赖）
const { runInNewContext } = await import('node:vm');
const dict = runInNewContext('(' + dictSrc + ')');

// ---- 3. 收集登录页真正用到的键 ----
const loginHtml = readFileSync(LOGIN_HTML, 'utf8');
const need = new Set();
for (const m of loginHtml.matchAll(/data-i18n(?:-html|-placeholder)?="([^"]+)"/g)) need.add(m[1]);
for (const m of head.matchAll(/\bt\(['"]([A-Za-z0-9_]+)['"]\)/g)) need.add(m[1]);
const keptKeys = Object.keys(dict.zh).filter(k => need.has(k));
console.log(`i18n：${Object.keys(dict.zh).length} 个键 → 保留 ${keptKeys.length} 个`);

const zh = {}, en = {};
for (const k of keptKeys) { zh[k] = dict.zh[k]; en[k] = dict.en[k] !== undefined ? dict.en[k] : dict.zh[k]; }
const dictOut = '// 只保留登录页用到的键（原字典约 65KB）\n'
  + 'var i18n = {\n  zh: {\n'
  + keptKeys.map(k => '    ' + k + ': ' + JSON.stringify(zh[k])).join(',\n')
  + '\n  },\n  en: {\n'
  + keptKeys.map(k => '    ' + k + ': ' + JSON.stringify(en[k])).join(',\n')
  + '\n  }\n};';

// ---- 4. 提取 i18n 辅助函数（getCurrentLang / t / loadLanguage），逐字取自 app.js ----
function extractFunction(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('找不到 function ' + name);
  const open = src.indexOf('{', idx);
  const close = matchBrace(src, open);
  return src.slice(idx, close + 1);
}
const helpers = [
  extractFunction(app, 'getCurrentLang'),
  extractFunction(app, 't'),
  extractFunction(app, 'loadLanguage'),
].join('\n');

// ---- 5. 组装 ----
const version = (app.match(/var APP_VERSION = '([^']+)'/) || [])[1] || '0.0.0';

const HEADER = `// ==========================================================================
// MiniChat 登录页专用脚本
//
// ⚠️ 本文件是【生成产物】，请勿手工编辑 —— 改这里会被下一次生成覆盖。
//     要改内容改 js/app.js 或 tools/login-page-bindings.js，然后执行：
//         node tools/build-login.mjs
//     核对是否与 app.js 同步：
//         node tools/check-login.mjs
//
// 生成来源：
//   · 代码主体  —— js/app.js 开头到 i18n 字典之前的全部内容（逐字）
//   · i18n 字典 —— 从 js/app.js 裁剪，只保留登录页用到的键
//   · 辅助函数  —— js/app.js 的 getCurrentLang / t / loadLanguage（逐字）
//   · 页面绑定  —— tools/login-page-bindings.js
//
// APP_VERSION 与 js/app.js 保持一致（当前 ${version}）
// ==========================================================================

`;

const bindings = readFileSync(BINDINGS, 'utf8');

const out = [
  HEADER,
  head,
  '\n',
  dictOut,
  '\n',
  helpers,
  '\n',
  'loadLanguage();',
  '\n\n',
  bindings,
].join('');

writeFileSync(LOGIN, out, 'utf8');

// ---- 6. 记录指纹，供 check 使用 ----
const fingerprint = createHash('sha256')
  .update(head).update('\u0000').update(keptKeys.join(',')).update('\u0000').update(helpers).update('\u0000').update(bindings)
  .digest('hex');
writeFileSync(MANIFEST, JSON.stringify({
  generatedAt: new Date().toISOString(),
  appVersion: version,
  fingerprint,
  i18nKeys: keptKeys.length,
  appJsBytes: app.length,
  loginJsBytes: out.length,
}, null, 2) + '\n', 'utf8');

console.log(`js/app.js  ${(app.length / 1024).toFixed(1)} KB`);
console.log(`js/login.js ${(out.length / 1024).toFixed(1)} KB  （${(app.length / out.length).toFixed(1)}× 小）`);
console.log(`指纹 ${fingerprint.slice(0, 16)}…  已写入 tools/login-build-manifest.json`);

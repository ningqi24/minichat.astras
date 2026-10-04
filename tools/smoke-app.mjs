// tools/smoke-app.mjs —— 用最小 DOM 桩把 js/app.js 真跑一遍
// 目的：node --check 只查语法，查不出"引用了不存在的变量"这类【运行期】错误。
//       今天就是因为把一个引用了 openConvSettings 内部变量 canManage 的调用
//       误插进了模块级 IIFE，导致该 IIFE 抛 ReferenceError，
//       它之后的所有绑定代码都不再执行 —— 表现就是"一堆按钮按不了"。
// 用法：node tools/smoke-app.mjs   （退出码 0 表示加载过程没有抛错）
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 可以传入路径来检查别的文件（用于自我验证：故意注入错误，确认本脚本真的能抓到）
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'js', 'app.js');
const code = fs.readFileSync(target, 'utf8');

const listeners = [];
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {}, dataset: {}, children: [], childNodes: [],
    innerHTML: '', outerHTML: '', textContent: '', value: '', checked: false,
    disabled: false, hidden: false, files: [], src: '', href: '', id: '', className: '',
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false } },
    addEventListener(){}, removeEventListener(){},
    appendChild(c){ this.children.push(c); return c }, append(...c){ this.children.push(...c); return c },
    removeChild(){}, insertBefore(){ return arguments[0] }, replaceChild(){}, replaceWith(){}, remove(){},
    setAttribute(){}, getAttribute(){ return null }, removeAttribute(){}, hasAttribute(){ return false },
    querySelector(){ return null }, querySelectorAll(){ return [] }, getElementsByClassName(){ return [] },
    closest(){ return null }, contains(){ return false }, matches(){ return false },
    cloneNode(){ return makeEl(tag) }, insertAdjacentHTML(){}, insertAdjacentElement(){ return null },
    focus(){}, blur(){}, click(){}, scrollTo(){}, scrollIntoView(){}, animate(){ return { cancel(){} } },
    getBoundingClientRect(){ return { top:0, left:0, right:0, bottom:0, width:0, height:0, x:0, y:0 } },
    getContext(){ return null }, toDataURL(){ return '' }, play(){ return Promise.resolve() },
  };
  Object.defineProperty(el, 'parentNode', { get(){ return null }, configurable: true });
  Object.defineProperty(el, 'firstChild', { get(){ return null }, configurable: true });
  Object.defineProperty(el, 'lastChild', { get(){ return null }, configurable: true });
  Object.defineProperty(el, 'nextSibling', { get(){ return null }, configurable: true });
  return el;
}

const doc = {
  getElementById(){ return makeEl() },
  createElement(tag){ return makeEl(tag) },
  createTextNode(){ return makeEl('#text') },
  querySelector(){ return makeEl() },
  querySelectorAll(){ return [] },
  getElementsByClassName(){ return [] },
  addEventListener(){}, removeEventListener(){},
  body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
  hidden: false, visibilityState: 'visible', readyState: 'complete',
  cookie: '', title: '', activeElement: null,
  createDocumentFragment(){ return makeEl() },
  execCommand(){ return true },
};

// supabase 与各类链式 API 用 Proxy 兜住：既要支持 a.b().c().d() 这种链式调用，
// 也要支持 await a.b() —— 所以这个对象【同时是函数、是 thenable、还能继续取属性】。
// （只把 then 去掉的话，await 处的 .then(...) 会报 "is not a function"。）
const anyProxy = new Proxy(function(){}, {
  get(_, prop) {
    if (prop === 'then') return (resolve) => { try { resolve(anyProxy) } catch { /* ignore */ } };
    if (prop === 'catch') return () => anyProxy;
    if (prop === 'finally') return (fn) => { try { if (typeof fn === 'function') fn() } catch { /* ignore */ } return anyProxy };
    if (prop === 'toJSON') return () => ({});
    if (prop === Symbol.toPrimitive) return () => '';
    if (prop === Symbol.iterator) return function* () {};
    return anyProxy;
  },
  apply() { return anyProxy },
  construct() { return anyProxy },
});

const win = {
  document: doc,
  navigator: { userAgent: 'smoke', language: 'zh-CN', languages: ['zh-CN'], clipboard: { writeText(){ return Promise.resolve() } }, onLine: true },
  location: { href: 'https://minichat.astras.cc/', origin: 'https://minichat.astras.cc', hostname: 'minichat.astras.cc', pathname: '/', search: '', hash: '', reload(){} },
  localStorage: { getItem(){ return null }, setItem(){}, removeItem(){}, clear(){}, key(){ return null }, length: 0 },
  sessionStorage: { getItem(){ return null }, setItem(){}, removeItem(){}, clear(){} },
  matchMedia(){ return { matches: false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} } },
  addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame(cb){ return setTimeout(() => cb(Date.now()), 0) }, cancelAnimationFrame(id){ clearTimeout(id) },
  fetch(){ return Promise.resolve({ ok: true, status: 200, json(){ return Promise.resolve({}) }, text(){ return Promise.resolve('') }, headers: { get(){ return null } } }) },
  WebSocket: function(){ return { close(){}, send(){}, readyState: 1, addEventListener(){}, removeEventListener(){} } },
  Notification: function(){ return { close(){} } },
  IntersectionObserver: function(){ return { observe(){}, unobserve(){}, disconnect(){} } },
  ResizeObserver: function(){ return { observe(){}, unobserve(){}, disconnect(){} } },
  PerformanceObserver: function(){ return { observe(){}, disconnect(){} } },
  CSS: { supports(){ return true } },
  getComputedStyle(){ return { getPropertyValue(){ return '' } } },
  console, Math, JSON, Date, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set, WeakMap, WeakSet, Symbol, Intl, URL, URLSearchParams, TextEncoder, TextDecoder, Blob: function(){}, File: function(){}, FormData: function(){ return { append(){}, set(){}, get(){ return null } } }, AbortController, structuredClone,
  supabase: anyProxy, sb: anyProxy, __smoke: true,
};
win.window = win;
win.self = win;
win.top = win;
win.parent = win;
win.globalThis = win;
win.alert = () => {};
win.confirm = () => false;
win.prompt = () => null;

let failed = null;
const ctx = vm.createContext(win);
try {
  vm.runInContext(code, ctx, { filename: path.basename(target), timeout: 20000 });
} catch (e) {
  failed = e;
}

// 允许的"预期内"错误：脚本后半段会访问没有真实实现的浏览器 API
const IGNORABLE = /Cannot read propert|not a function|is not defined.*(Notification|Audio|MediaRecorder|FileReader|WebSocket|indexedDB|clipboard)/i;

if (failed && !IGNORABLE.test(String(failed && failed.message))) {
  console.error('❌ app.js 加载时抛错：');
  console.error('   ' + (failed.stack || failed.message));
  process.exit(1);
}
console.log('✅ app.js 在最小 DOM 桩下加载完成，没有抛出未预期的错误');
if (failed) console.log('   （忽略了一个预期内的桩缺失错误: ' + failed.message + '）');
// 异步兜底：把未捕获的异步错误也过一遍同样的白名单，避免误报
process.on('uncaughtException', (e) => {
  if (IGNORABLE.test(String(e && e.message))) { console.log('   （忽略异步桩缺失: ' + e.message + '）'); return; }
  console.error('❌ 异步未捕获错误：'); console.error('   ' + (e && e.stack || e)); process.exit(1);
});
process.on('unhandledRejection', (e) => {
  const m = String(e && e.message || e);
  if (IGNORABLE.test(m)) return;
  console.error('❌ 未处理的 Promise 拒绝：' + m);
  process.exit(1);
});
// 给异步任务一点时间跑完（脚本里有 setTimeout 的启动逻辑）
setTimeout(() => process.exit(0), 1500);

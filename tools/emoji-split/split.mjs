// MiniChat 表情数据拆分脚本
//
// 用途：把「一整包」表情数据（emojihub-all.json + kaomoji.json）拆成
//       data/emoji-index.json + data/emoji/*.json + data/kaomoji/*.json，
//       供前端按分类懒加载。
//
// ⚠️ 注意：data/kaomoji.json 与 data/emojihub-all.json 已于 4.10.2 从仓库移除，
//          现在【分片文件本身就是权威数据】。要重跑本脚本，先从历史里取回源文件：
//            git show 4.10.1:data/kaomoji.json      > data/kaomoji.json
//            git show 4.10.1:data/emojihub-all.json > data/emojihub-all.json
//          再执行：node tools/emoji-split/split.mjs
//
// 归类规则在 merge-rules.json（[大类名, [关键词...]]）。匹配方式：
// 按分类名的小写子串匹配，规则顺序即优先级，先命中先归类，都不中则归入「其他」。
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');          // 仓库根
const DATA = join(ROOT, 'data');

const RULES = JSON.parse(readFileSync(join(HERE, 'merge-rules.json'), 'utf8'));

// 中文大类 -> 英文文件名
const KEYS = {
  "表情与人物": "smileys-people",
  "动物与自然": "animals-nature",
  "食物与饮品": "food-drink",
  "旅行与地点": "travel-places",
  "活动": "activities",
  "物品": "objects",
  "符号": "symbols",
  "旗帜": "flags",
  "动作 / 手势": "action",
  "自然 / 天气": "nature",
  "生气 / 无语": "angry",
  "开心 / 笑": "happy",
  "动物": "animal",
  "搞怪 / 表情": "weird",
  "拟声 / 语气": "onomatopoeia",
  "哭泣 / 难过": "sad",
  "害羞 / 紧张": "shy",
  "可爱 / 卖萌": "cute",
  "人际 / 礼貌": "polite",
  "惊讶 / 震惊": "surprise",
  "爱心 / 亲密": "love",
  "角色 / 卡通": "character",
  "吃喝": "food",
  "睡觉 / 放松": "sleep",
  "物品 / 科技": "gadget",
  "思考 / 心理": "think",
  "线条 / 符号": "symbol",
  "节日 / 活动": "event",
  "其他": "others"
};

// emojihub 的英文分类 -> 中文标签
const EMOJI_CN = {
  'smileys and people': '表情与人物',
  'animals and nature': '动物与自然',
  'food and drink': '食物与饮品',
  'travel and places': '旅行与地点',
  'activities': '活动',
  'objects': '物品',
  'symbols': '符号',
  'flags': '旗帜',
};

function dec(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)));
}

// 对齐 app.js 的 toEmojiChar：'U+1F600' / '1F600' -> 真正的字符
function toEmojiChar(code) {
  if (typeof code !== 'string') return code;
  const parts = code.trim().split(/\s+/);
  if (parts.length > 1 && parts.every(p => /^U\+[0-9A-Fa-f]+$/.test(p))) {
    return parts.map(p => String.fromCodePoint(parseInt(p.slice(2), 16))).join('');
  }
  if (code.startsWith('U+')) return String.fromCodePoint(parseInt(code.slice(2), 16));
  if (/^[0-9A-Fa-f]+$/.test(code)) return String.fromCodePoint(parseInt(code, 16));
  return code;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'g';
}

function classify(name) {
  const s = name.toLowerCase();
  for (const [group, keys] of RULES) {
    for (const k of keys) if (s.includes(k)) return group;
  }
  return '其他';
}

// ---- 读源数据 ----
const emojiSrc = join(DATA, 'emojihub-all.json');
const kaoSrc = join(DATA, 'kaomoji.json');
if (!existsSync(emojiSrc) || !existsSync(kaoSrc)) {
  console.error('缺少源文件 data/emojihub-all.json 或 data/kaomoji.json');
  console.error('它们已于 4.10.2 移除，先从历史里取回（见本文件开头注释）。');
  process.exit(1);
}

const emojiRaw = JSON.parse(readFileSync(emojiSrc, 'utf8'));
const eg = {};
for (const it of emojiRaw) {
  const c = it.category || '其他';
  (eg[c] ||= []);
  let u = it.unicode; if (Array.isArray(u)) u = u[0];
  if (u) eg[c].push(toEmojiChar(u));
  else if (it.htmlCode && it.htmlCode.length) eg[c].push({ __html: Array.isArray(it.htmlCode) ? it.htmlCode[0] : it.htmlCode });
}

const kaoRaw = JSON.parse(readFileSync(kaoSrc, 'utf8'));
const kg = {};
for (const [name, list] of Object.entries(kaoRaw)) {
  (kg[classify(name)] ||= []).push(...list.map(dec));
}

// ---- 写分片 ----
for (const d of ['emoji', 'kaomoji']) rmSync(join(DATA, d), { recursive: true, force: true });
mkdirSync(join(DATA, 'emoji'), { recursive: true });
mkdirSync(join(DATA, 'kaomoji'), { recursive: true });

const groups = [];
const used = new Set();
function emit(kind, label, items, key) {
  let s = key || slug(label);
  const base = s; let i = 2;
  while (used.has(kind + ':' + s)) s = base + '-' + (i++);
  used.add(kind + ':' + s);
  const rel = 'data/' + kind + '/' + s + '.json';
  writeFileSync(join(ROOT, rel), JSON.stringify(items));
  const f = items.find(x => typeof x === 'string' && x.trim()) || items[0];
  const icon = typeof f === 'string' ? f : (f && f.__html ? String(f.__html).replace(/<[^>]*>/g, '') : '');
  groups.push({ id: kind + ':' + s, label, kind, file: '/' + rel, icon: String(icon).slice(0, 4), count: items.length });
}

for (const [c, list] of Object.entries(eg)) emit('emoji', EMOJI_CN[c] || c, list, slug(c));
for (const [c, list] of Object.entries(kg).sort((a, b) => b[1].length - a[1].length)) emit('kaomoji', c, list, KEYS[c] || slug(c));

writeFileSync(join(DATA, 'emoji-index.json'), JSON.stringify({ version: 2, groups }));

let total = 0;
for (const g of groups) total += statSync(join(ROOT, g.file)).size;
console.log(`大类 ${groups.length} 个（${Object.keys(eg).length} emoji + ${Object.keys(kg).length} 颜文字）`);
console.log(`分片总计 ${(total / 1024).toFixed(1)} KB   索引 ${(statSync(join(DATA, 'emoji-index.json')).size / 1024).toFixed(1)} KB`);
for (const g of groups) {
  console.log(`  ${g.icon.padEnd(3)} ${String(g.count).padStart(5)} 条  ${g.file}`);
}

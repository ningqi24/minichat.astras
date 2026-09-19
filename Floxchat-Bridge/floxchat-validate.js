
const fs = require('fs');
const dir = process.argv[2];
const j = JSON.parse(fs.readFileSync(dir + '/project.json', 'utf8'));
let errors = 0;
const err = (m) => { errors++; if (errors < 40) console.log('  ERROR ' + m); };

for (const t of j.targets) {
  const B = t.blocks || {};
  for (const id in B) {
    const b = B[id];
    if (b.next) {
      if (!B[b.next]) err(t.name + ': ' + id + '.next -> 不存在的块 ' + b.next);
      else if (B[b.next].parent !== id) err(t.name + ': ' + b.next + '.parent=' + B[b.next].parent + ' 应为 ' + id);
    }
    if (b.parent) {
      if (!B[b.parent]) err(t.name + ': ' + id + '.parent -> 不存在的块 ' + b.parent);
    }
    for (const k in (b.inputs || {})) {
      const v = b.inputs[k];
      if (!Array.isArray(v)) continue;
      for (let i = 1; i < v.length; i++) {
        const ref = v[i];
        if (typeof ref !== 'string') continue;
        if (!B[ref]) err(t.name + ': ' + id + '.' + k + ' -> 不存在的块 ' + ref);
      }
    }
  }
  // 每个块都应能从某个 topLevel 或某父块的输入到达
  const reachable = new Set();
  const walk = (id) => { if (!id || reachable.has(id) || !B[id]) return; reachable.add(id); walk(B[id].next); for (const k in (B[id].inputs||{})) { const v = B[id].inputs[k]; if (Array.isArray(v)) { for (let i=1;i<v.length;i++) if (typeof v[i]==='string') walk(v[i]); } } };
  for (const id in B) { const b = B[id]; if (b.topLevel) { reachable.add(id); walk(b.next); for (const k in (b.inputs||{})) { const v=b.inputs[k]; if (Array.isArray(v)) for (let i=1;i<v.length;i++) if (typeof v[i]==='string') walk(v[i]); } } }
  let unreachable = 0;
  for (const id in B) if (!reachable.has(id)) unreachable++;
  if (unreachable) console.log('  [' + t.name + '] 不可达块: ' + unreachable + ' / ' + Object.keys(B).length);
}
// 资产
let missing = 0;
const files = new Set(fs.readdirSync(dir));
for (const t of j.targets) for (const c of (t.costumes || [])) if (c.md5ext && !files.has(c.md5ext)) { missing++; if (missing < 10) console.log('  缺资产: ' + c.md5ext); }
for (const t of j.targets) for (const s of (t.sounds || [])) if (s.md5ext && !files.has(s.md5ext)) { missing++; if (missing < 10) console.log('  缺音频: ' + s.md5ext); }
// 额外：同一个块不能被多个输入引用（Scratch 要求块是树而非图）
for (const t of j.targets) {
  const B2 = t.blocks || {};
  const refs = {};
  for (const id in B2) {
    const b = B2[id];
    for (const k in (b.inputs || {})) {
      const vv = b.inputs[k];
      if (!Array.isArray(vv)) continue;
      for (let i = 1; i < vv.length; i++) if (typeof vv[i] === 'string') (refs[vv[i]] = refs[vv[i]] || []).push(id + '.' + k);
    }
  }
  for (const refId in refs) if (refs[refId].length > 1) err(t.name + ': 块 ' + refId + ' 被多处引用 -> ' + refs[refId].join(', '));
}
console.log('校验完成，错误 ' + errors + ' 个，缺资产 ' + missing + ' 个');


const fs = require('fs');
const src = process.argv[2];
const dst = process.argv[3];
const j = JSON.parse(fs.readFileSync(src, 'utf8'));
const EXT = 'minichatbridge';
// FloxChat 的群聊 ID 规范：统一 7 位（GID+4位数字 / FLOXGRP / SAYLINK 都是 7 位）
const GID = 'MINCHAT';
const GNAME = 'MiniChat 群聊';
// 150x150 圆形：FloxChat 的群头像/用户头像规格（原作者确认）。
// FloxChat 用「set size to N%」缩放头像，N% 相对图片自然尺寸，
// 所以尺寸必须是 150x150 才能和其他群头像一样大。
const GAVATAR = 'https://minichat.astras.cc/Floxchat-Bridge/minichat-avatar-150.svg';
// ⚠️ 扩展 JS 走 GitHub Pages，缓存头是 max-age=3600（一小时）。
// 不带版本号的话，改完扩展用户重开工程也会继续用浏览器缓存里的旧 JS。
// 每次改 minichat-bridge.js 就把这个号 +1，并重新打包 sb3。
const EXT_VER = '21';
const EXT_URL = 'https://minichat.astras.cc/Floxchat-Bridge/minichat-bridge.js?v=' + EXT_VER;
const log = [];
let seq = 0;
function nid(tag) { seq++; return 'mc_' + tag + '_' + seq; }
function T(name) { const t = j.targets.find(x => x.name === name); if (!t) throw new Error('找不到精灵: ' + name); return t; }
function varId(name) {
  for (const t of j.targets) { const V = t.variables || {}; for (const id in V) if (V[id][0] === name) return id; }
  throw new Error('找不到变量: ' + name);
}
function listId(name) {
  for (const t of j.targets) { const L = t.lists || {}; for (const id in L) if (L[id][0] === name) return id; }
  throw new Error('找不到列表: ' + name);
}
function mkBlock(t, opcode, inputs, fields, shadow) {
  const id = nid('b');
  if (t.blocks[id]) throw new Error('id 冲突 ' + id);
  t.blocks[id] = { opcode: opcode, next: null, parent: null, inputs: inputs || {}, fields: fields || {}, shadow: !!shadow, topLevel: false };
  return id;
}
function lit(v) { return [1, [10, String(v)]]; }
function link(t, fromId, toId) {
  t.blocks[fromId].next = toId;
  if (toId) t.blocks[toId].parent = fromId;
}
function menuInput(t, listName, ownerId) {
  const mid = mkBlock(t, EXT + '_menu_lists', {}, { lists: [listName, null] }, true);
  t.blocks[mid].parent = ownerId;
  return [1, mid];
}
function varReporter(t, name) { return mkBlock(t, 'data_variable', {}, { VARIABLE: [name, varId(name)] }); }
function eqConst(t, varName, value) {
  const v = varReporter(t, varName);
  const c = mkBlock(t, 'operator_equals', { OPERAND1: [3, v, [10, '']], OPERAND2: lit(value) }, {});
  t.blocks[v].parent = c;
  return c;
}
function notOf(t, innerId) {
  const n = mkBlock(t, 'operator_not', { OPERAND: [2, innerId] }, {});
  t.blocks[innerId].parent = n;
  return n;
}
function findVarSetter(t, varName, valueIsVariable) {
  for (const id in t.blocks) {
    const b = t.blocks[id];
    if (b.opcode !== 'data_setvariableto') continue;
    if (!b.fields.VARIABLE || b.fields.VARIABLE[0] !== varName) continue;
    const v = b.inputs && b.inputs.VALUE;
    if (!v) continue;
    const isVar = v[1] && typeof v[1] === 'object' && v[1][0] === 12;
    if (valueIsVariable === undefined || isVar === valueIsVariable) return id;
  }
  return null;
}
function findIfWithSubstackHead(t, headOpcode, varName) {
  for (const id in t.blocks) {
    const b = t.blocks[id];
    if (b.opcode !== 'control_if' && b.opcode !== 'control_if_else') continue;
    const v = b.inputs && b.inputs.SUBSTACK;
    if (!v || typeof v[1] !== 'string') continue;
    const h = t.blocks[v[1]];
    if (!h) continue;
    if (headOpcode && h.opcode === headOpcode) return { ifId: id, headId: v[1] };
    if (varName && h.opcode === 'data_setvariableto' && h.fields.VARIABLE && h.fields.VARIABLE[0] === varName) return { ifId: id, headId: v[1] };
  }
  return null;
}

// ---- 补丁 1：往 FloxChat 的群聊列表里注入 MiniChat 条目 ----
// 关键：FloxChat 真正渲染的列表是「已登录用户所有群聊信息」，它是 3 个一组的扁平数据
//      （gid / name / avatar_url），并且靠循环里的 {_ = 「创建 %s %s %s」过程逐个生成克隆体。
//      所以不能只往「获取所有群聊」塞一个 JSON 对象——那样会被它的过滤循环丢掉。
//      这里直接把 3 条扁平数据追加进去，再按它原本的调用方式调一次「创建」。
(function () {
  const t = T('群聊列表');
  const stageSetter = findVarSetter(t, '阶段');
  const prev = t.blocks[stageSetter].parent;
  const info = ['已登录用户所有群聊信息', listId('已登录用户所有群聊信息')];
  const mine = ['已登录用户所在群聊', listId('已登录用户所在群聊')];

  // 克隆体的 Y 坐标是用 data_itemnumoflist(群聊克隆体ID, 已登录用户所在群聊) 算行号的，
  // 找不到会返回 0，整行就会被顶到搜索框那一行。所以必须把 MINCHAT 也登记进「我所在的群聊」。
  // 注意：这必须发生在过滤循环之后（本注入点正好在「阶段 = 群聊获取完毕」之前），
  // 否则循环会多跑一轮，还可能因为 contains 匹配空串而多出一个空行。
  const a0 = mkBlock(t, 'data_addtolist', { ITEM: lit(GID) }, { LIST: mine });

  const a1 = mkBlock(t, 'data_addtolist', { ITEM: lit(GID) }, { LIST: info });
  const a2 = mkBlock(t, 'data_addtolist', { ITEM: lit(GNAME) }, { LIST: info });
  const a3 = mkBlock(t, 'data_addtolist', { ITEM: lit(GAVATAR) }, { LIST: info });

  // 复用 FloxChat 自己的「创建 %s %s %s」过程（proccode 与 argumentids 取自工程里的原型）
  const ARG_NAME = 'vr#u1On.Vebw+UxPvn#?';
  const ARG_ID = 'wqp,(%qz:/mGV0[sn{0^';
  const ARG_AVATAR = 'Eg.wBmEb72t{)uk(,j{L';
  const call = mkBlock(t, 'procedures_call', {}, {});
  t.blocks[call].inputs[ARG_NAME] = [1, [10, GNAME]];
  t.blocks[call].inputs[ARG_ID] = [1, [10, GID]];
  t.blocks[call].inputs[ARG_AVATAR] = [1, [10, GAVATAR]];
  t.blocks[call].mutation = {
    tagName: 'mutation',
    children: [],
    proccode: '创建 %s %s %s',
    argumentids: '["' + ARG_NAME + '","' + ARG_ID + '","' + ARG_AVATAR + '"]',
    warp: 'true'
  };

  link(t, a0, a1);
  link(t, a1, a2);
  link(t, a2, a3);
  link(t, a3, call);
  link(t, prev, a0);
  link(t, call, stageSetter);
  log.push('补丁1: 在 ' + prev + ' 与 ' + stageSetter + ' 之间注入 MiniChat 群聊（登记所在群聊 + 3 条扁平数据 + 调用「创建」）');
})();

// ---- 补丁 2：点击群聊时清场 + 开关自动推送 ----
(function () {
  const t = T('群聊列表');
  const setter = findVarSetter(t, '当前显示的群聊ID', true);
  const after = t.blocks[setter].next;
  const cond = eqConst(t, '当前显示的群聊ID', GID);
  // 进 MiniChat 群时先确保桥接已连接（用当前 FloxChat 账号的邮箱）。
  // 这一步很关键：老用户是「本地已登录」进来的，不会触发登录事件，补丁 8 就不会跑；
  // 没有 token 的话自动推送不会回填历史消息，聊天区就是空的。
  const lname = '已登录用户信息';
  const info = [lname, listId(lname)];
  const emailRep = mkBlock(t, 'data_itemoflist', { INDEX: [1, [7, '4']] }, { LIST: info });
  const nameRep = mkBlock(t, 'data_itemoflist', { INDEX: [1, [7, '2']] }, { LIST: info });
  const conn = mkBlock(t, EXT + '_connect', {}, {});
  t.blocks[conn].inputs.EMAIL = [3, emailRep, [10, '']];
  t.blocks[conn].inputs.NAME = [3, nameRep, [10, '']];
  t.blocks[emailRep].parent = conn;
  t.blocks[nameRep].parent = conn;

  const delA = mkBlock(t, 'data_deletealloflist', {}, { LIST: ['当前显示的群聊', listId('当前显示的群聊')] });
  const delB = mkBlock(t, 'data_deletealloflist', {}, { LIST: ['已显示消息', listId('已显示消息')] });
  const reset = mkBlock(t, EXT + '_floxResetCursor', {}, {});
  const auto = mkBlock(t, EXT + '_floxAutoPush', {}, {});
  t.blocks[auto].inputs.LIST = menuInput(t, '当前显示的群聊', auto);
  // 如果连接失败（最常见：这个 FloxChat 邮箱还没开通 MiniChat 账号），
  // 就把桥接错误直接作为一条聊天气泡显示出来，避免「一片空白不知道为啥」。
  const errRepA = mkBlock(t, EXT + '_bridgeError', {}, {});
  const emptyLit = mkBlock(t, 'operator_equals', { OPERAND1: [3, errRepA, [10, '']], OPERAND2: [1, [10, '']] }, {});
  t.blocks[errRepA].parent = emptyLit;
  const hasErr = notOf(t, emptyLit);
  const errRepB = mkBlock(t, EXT + '_bridgeError', {}, {});
  const HALF1 = '{"username":"MiniChat 桥接","uid":"","avatar_url":"","content":"';
  const HALF2 = '","time":"","mid":"bridge"}';
  // ⚠️ FloxChat 渲染时是 Encoding_decode(Base64, content)，所以 content 必须是 Base64。
  // 这里直接复用工程自带的 Encoding 扩展把错误文本编码一遍。
  const encMenu = mkBlock(t, 'Encoding_menu_encode', {}, { encode: ['Base64', null] }, true);
  const encBlk = mkBlock(t, 'Encoding_encode', { code: [1, encMenu], string: [3, errRepB, [10, '']] }, {});
  t.blocks[encMenu].parent = encBlk;
  t.blocks[errRepB].parent = encBlk;
  const j2 = mkBlock(t, 'operator_join', { STRING1: [3, encBlk, [10, '']], STRING2: [1, [10, HALF2]] }, {});
  t.blocks[encBlk].parent = j2;
  const j1 = mkBlock(t, 'operator_join', { STRING1: [1, [10, HALF1]], STRING2: [3, j2, [10, '']] }, {});
  t.blocks[j2].parent = j1;
  const addErr = mkBlock(t, 'data_addtolist', { ITEM: [3, j1, [10, '']] }, { LIST: ['当前显示的群聊', listId('当前显示的群聊')] });
  t.blocks[j1].parent = addErr;
  const ifErr = mkBlock(t, 'control_if', { CONDITION: [2, hasErr], SUBSTACK: [2, addErr] }, {});
  t.blocks[hasErr].parent = ifErr;
  t.blocks[addErr].parent = ifErr;

  const off = mkBlock(t, EXT + '_floxAutoPushOff', {}, {});
  const ifelse = mkBlock(t, 'control_if_else', { CONDITION: [2, cond], SUBSTACK: [2, conn], SUBSTACK2: [2, off] }, {});
  t.blocks[cond].parent = ifelse;
  t.blocks[conn].parent = ifelse;
  t.blocks[off].parent = ifelse;
  link(t, conn, delA); link(t, delA, delB); link(t, delB, ifErr); link(t, ifErr, reset); link(t, reset, auto);
  link(t, setter, ifelse);
  link(t, ifelse, after);
  log.push('补丁2: 在 ' + setter + ' 之后插入 ' + ifelse + ' (连 MiniChat + 清场 + 出错就把错误显示成气泡 + 开自动推送)');
})();

// ---- 补丁 3：消息刷新时跳过 FloxChat 的 HTTP ----
// ⚠️ 这里非常容易写错：Ed 的 SUBSTACK 是【一条长链】，
//    aia HTTP清空 → Ee → Ef → Eg → Eh → ed setList(响应) → Ei 算刷新条数 → ee 渲染
//    只有前面 HTTP 那几块该被守卫包住；Ei / ee 必须留在【守卫外面】，
//    否则 MiniChat 分支会把渲染也一起跳过 —— 表现就是「一条消息都没有，
//    连错误气泡也不显示」（气泡写进列表了，但没人渲染它）。
(function () {
  const t = T('消息显示');
  const f = findIfWithSubstackHead(t, 'gsaHTTPRequests_clearAll');
  if (!f) throw new Error('补丁3: 未找到 HTTP 分支');
  // 顺着 HTTP 链找到「把响应写回 当前显示的群聊」那一块，它后面就是渲染链
  const target = listId('当前显示的群聊');
  let cur = f.headId, setListId = null;
  for (let i = 0; cur && i < 20; i++) {
    const b = t.blocks[cur];
    if (!b) break;
    if (b.opcode === 'skyhigh173JSON_json_vm_setlist') {
      const v = b.inputs.list;
      if (v && typeof v[1] === 'string') {
        const m = t.blocks[v[1]];
        if (m && m.fields && m.fields.get_list && m.fields.get_list[0] === target) { setListId = cur; break; }
      }
    }
    cur = b.next;
  }
  if (!setListId) throw new Error('补丁3: 未在 HTTP 链里找到 setList 块');
  const after = t.blocks[setListId].next;          // ← 渲染链的第一块（Ei）

  // P2.5.1 起新增了一道闸：渲染前会检查
  //   当前显示的群聊ID == 当前实际显示的群聊
  // 不等就先「广播刷新消息 + 停止」。
  // 而那个赋值原本写在 HTTP 段里（就在 setList 之前），MiniChat 分支被守卫跳过，
  // 于是闸门永远不成立 —— 每轮都广播刷新并停住，消息一条都渲染不出来。
  // 所以在守卫【外面】补一个同样的赋值。老版本没有这个变量，自动跳过。
  let markId = null;
  let markVarId = null;
  for (const t2 of j.targets) {
    const V = t2.variables || {};
    for (const id in V) if (V[id][0] === '当前实际显示的群聊') markVarId = id;
  }
  if (markVarId) {
    const rep = mkBlock(t, 'data_variable', {}, { VARIABLE: ['当前显示的群聊ID', varId('当前显示的群聊ID')] });
    markId = mkBlock(t, 'data_setvariableto', { VALUE: [3, rep, [10, '0']] }, { VARIABLE: ['当前实际显示的群聊', markVarId] });
    t.blocks[rep].parent = markId;
  }

  const neg = notOf(t, eqConst(t, '当前显示的群聊ID', GID));
  const g = mkBlock(t, 'control_if', { CONDITION: [2, neg], SUBSTACK: [2, f.headId] }, {});
  t.blocks[neg].parent = g;
  t.blocks[f.headId].parent = g;
  t.blocks[setListId].next = null;                 // HTTP 链到此为止
  t.blocks[f.ifId].inputs.SUBSTACK = [2, g];
  t.blocks[g].parent = f.ifId;

  link(t, g, markId || after);                     // 守卫 →（补的赋值）→ 渲染链
  if (markId) link(t, markId, after);
  log.push('补丁3: 只把 HTTP 段 ' + f.headId + '..' + setListId + ' 包进守卫 ' + g +
    '；渲染链 ' + after + ' 留在外面' + (markId ? '；并补了「当前实际显示的群聊 = 当前显示的群聊ID」(' + markId + ')' : '（老版本无此闸）'));
})();

// ---- 补丁 4：发送时按群走不同通道 ----
(function () {
  const t = T('通讯');
  const f = findIfWithSubstackHead(t, null, '发送消息等待');
  if (!f) throw new Error('补丁4: 未找到发送分支');
  const cond = eqConst(t, '当前显示的群聊ID', GID);
  const getInput = mkBlock(t, 'cyberexplorertoolboxmini_getInputProperty', { id: lit('消息输入框') }, { type: ['content', null] });
  const sendB = mkBlock(t, EXT + '_send', {}, {});
  t.blocks[sendB].inputs.MSG = [3, getInput, [10, '']];
  t.blocks[getInput].parent = sendB;
  const clearIn = mkBlock(t, 'cyberexplorertoolboxmini_setInputProperty', { id: lit('消息输入框'), text: lit('') }, { type: ['content', null] });
  const edit = mkBlock(t, 'cyberexplorertoolboxmini_setInputReadability', { id: lit('消息输入框') }, { read: ['editable', null] });
  const ifelse = mkBlock(t, 'control_if_else', { CONDITION: [2, cond], SUBSTACK: [2, sendB], SUBSTACK2: [2, f.headId] }, {});
  t.blocks[cond].parent = ifelse;
  t.blocks[sendB].parent = ifelse;
  t.blocks[f.headId].parent = ifelse;
  link(t, sendB, clearIn); link(t, clearIn, edit);
  t.blocks[f.ifId].inputs.SUBSTACK = [2, ifelse];
  t.blocks[ifelse].parent = f.ifId;
  log.push('补丁4: ' + f.ifId + '.SUBSTACK 从 ' + f.headId + ' 改为 ' + ifelse + ' (MiniChat 走扩展，否则走原 HTTP)');
})();

// ---- 补丁 6：防止 FloxChat 的响应覆盖我们推进去的 MiniChat 消息 ----
(function () {
  const t = T('群聊列表');
  const hits = [];
  for (const id in t.blocks) {
    const b = t.blocks[id];
    if (b.opcode !== 'control_if') continue;
    const v = b.inputs && b.inputs.SUBSTACK;
    if (!v || typeof v[1] !== 'string') continue;
    const h = t.blocks[v[1]];
    if (h && h.opcode === 'skyhigh173JSON_json_vm_setlist') hits.push({ ifId: id, headId: v[1] });
  }
  if (hits.length !== 1) throw new Error('补丁6: 期望恰好 1 处 setList 分支，实际 ' + hits.length);
  const f = hits[0];
  const neg = notOf(t, eqConst(t, '当前显示的群聊ID', GID));
  const g = mkBlock(t, 'control_if', { CONDITION: [2, neg], SUBSTACK: [2, f.headId] }, {});
  t.blocks[neg].parent = g;
  t.blocks[f.headId].parent = g;
  t.blocks[f.ifId].inputs.SUBSTACK = [2, g];
  t.blocks[g].parent = f.ifId;
  log.push('补丁6: ' + f.ifId + '.SUBSTACK 从 ' + f.headId + ' 改为 ' + g + ' (MiniChat 时不允许响应覆盖列表)');
})();

// ---- 补丁 7：FloxChat 注册验证通过时，顺手用同一个验证码开通/登录 MiniChat ----
(function () {
  const t = T('主页');
  const hits = [];
  for (const id in t.blocks) {
    const b = t.blocks[id];
    if (b.opcode !== 'control_if_else') continue;
    const v = b.inputs && b.inputs.SUBSTACK2;
    if (!v || typeof v[1] !== 'string') continue;
    const h = t.blocks[v[1]];
    if (h && h.opcode === 'gsaHTTPRequests_clearAll') hits.push({ ifId: id, headId: v[1] });
  }
  if (hits.length !== 1) throw new Error('补丁7: 期望恰好 1 处「注册验证成功」分支，实际 ' + hits.length);
  const f = hits[0];
  const emailB = mkBlock(t, 'cyberexplorertoolboxmini_getInputProperty', { id: lit('Register2Username') }, { type: ['content', null] });
  const codeB = mkBlock(t, 'cyberexplorertoolboxmini_getInputProperty', { id: lit('Register2Password') }, { type: ['content', null] });
  const call = mkBlock(t, EXT + '_connectByCode', {}, {});
  t.blocks[call].inputs.CODE = [3, codeB, [10, '']];
  t.blocks[call].inputs.EMAIL = [3, emailB, [10, '']];
  t.blocks[emailB].parent = call;
  t.blocks[codeB].parent = call;
  t.blocks[call].next = f.headId;
  t.blocks[f.headId].parent = call;
  t.blocks[call].parent = f.ifId;
  t.blocks[f.ifId].inputs.SUBSTACK2 = [2, call];
  log.push('补丁7: 注册验证成功后先调 ' + call + ' (' + EXT + '_connectByCode，邮箱=Register2Username，验证码=Register2Password)');
})();

// ---- 补丁 8：FloxChat 登录验证成功时，用该账号的邮箱自动连上 MiniChat ----
(function () {
  const t = T('主页');
  const hits = [];
  for (const id in t.blocks) {
    const b = t.blocks[id];
    if (b.opcode !== 'event_broadcast') continue;
    const v = b.inputs && b.inputs.BROADCAST_INPUT;
    if (v && Array.isArray(v[1]) && v[1][1] === '登录验证成功通知') hits.push(id);
  }
  if (hits.length !== 1) throw new Error('补丁8: 期望恰好 1 处「登录验证成功通知」广播，实际 ' + hits.length);
  const anchor = hits[0];
  const lname = '已登录用户信息';
  const info = [lname, listId(lname)];
  const emailRep = mkBlock(t, 'data_itemoflist', { INDEX: [1, [7, '4']] }, { LIST: info });
  const nameRep = mkBlock(t, 'data_itemoflist', { INDEX: [1, [7, '2']] }, { LIST: info });
  const call = mkBlock(t, EXT + '_connect', {}, {});
  t.blocks[call].inputs.EMAIL = [3, emailRep, [10, '']];
  t.blocks[call].inputs.NAME = [3, nameRep, [10, '']];
  t.blocks[emailRep].parent = call;
  t.blocks[nameRep].parent = call;
  const after = t.blocks[anchor].next;
  link(t, anchor, call);
  link(t, call, after);
  log.push('补丁8: 登录验证成功后调 ' + call + ' (' + EXT + '_connect，邮箱取 已登录用户信息[4]，昵称取 [2])');
})();

// ---- 补丁 9：MiniChat 群完全跳过「退出群聊」流程 ----
// MiniChat 群是桥接注入的【本地哨兵】，在 FloxChat 服务端根本不存在，退它没有意义。
// 而且原版退群对非默认群本来就是半成品（服务端写的是占位 uid "UID0001"），
// 接上去只会踩坑（之前的现象：退完群聊列表和消息区全空）。
// 做法：把「提示标」里那个接收器的整个 SUBSTACK 包进守卫。
// 守卫条件用的是 当前显示的群聊ID —— 它在流程内部才被清空，所以进守卫时还在。
(function () {
  const t = T('提示标');
  let hat = null;
  for (const id in t.blocks) {
    const b = t.blocks[id];
    if (b.opcode === 'event_whenbroadcastreceived' && b.fields.BROADCAST_OPTION && b.fields.BROADCAST_OPTION[0] === '退出群聊') hat = id;
  }
  if (!hat) throw new Error('补丁9: 提示标里没找到「退出群聊」接收器');
  const outer = t.blocks[hat].next;
  if (!outer) throw new Error('补丁9: 「退出群聊」下面没有块');
  const sv = t.blocks[outer].inputs && t.blocks[outer].inputs.SUBSTACK;
  if (!sv || typeof sv[1] !== 'string') throw new Error('补丁9: 第一块不是带 SUBSTACK 的控制块（' + t.blocks[outer].opcode + '）');
  const head = sv[1];

  // MiniChat 分支：不做事，只弹一个和原版同款的窗口（借用它自己的「创建窗口」过程）。
  // 参数 id 和 proccode 是从工程里读出来的，调用块本身是【新增】的，没改原积木。
  const A_TITLE = '}z_7!=yrcNgOn8`SopS*';
  const A_CONTENT = '*~w+tlqibsN6@!Mid881';
  const A_YESNO = '0!R]u`PONbLh=wuo=jGR';
  const A_DARK = 'Aum]pFaWTN+i6tqkL^fh';
  const dialog = mkBlock(t, 'procedures_call', {
    [A_TITLE]:   [1, [10, '退出群聊']],
    [A_CONTENT]: [1, [10, '无法退出 MiniChat 群：它由桥接注入，在 FloxChat 服务器上并不存在。']],
    [A_YESNO]:   [1, [10, '1']],
    [A_DARK]:    [1, [10, '1']]
  }, {});
  t.blocks[dialog].mutation = {
    tagName: 'mutation', children: [],
    proccode: '创建窗口 | 标题 %s 内容 %s 包含“否”？ %s 暗色模式 %s',
    argumentids: JSON.stringify([A_TITLE, A_CONTENT, A_YESNO, A_DARK]),
    wasm: 'false'
  };

  const cond = eqConst(t, '当前显示的群聊ID', GID);   // == MINICHAT -> 弹窗
  const g = mkBlock(t, 'control_if_else', { CONDITION: [2, cond], SUBSTACK: [2, dialog], SUBSTACK2: [2, head] }, {});
  t.blocks[cond].parent = g;
  t.blocks[dialog].parent = g;
  t.blocks[head].parent = g;
  t.blocks[outer].inputs.SUBSTACK = [2, g];
  t.blocks[g].parent = outer;
  log.push('补丁9: MiniChat 群跳过整个退群流程并弹提示（' + outer + '.SUBSTACK 从 ' + head + ' 改为 ' + g + '）');
})();

// ---- 补丁 11：MiniChat 群退出时不要删掉群聊列表里的那一行 ----
// 「群聊列表」里还有一个「收到 退出群聊」的接收器：停掉该角色其它脚本 -> 淡出 -> 删除那一行的克隆体。
// 补丁9 只挡了「提示标」那一边，这一个不挡的话 MiniChat 那一行还是会从列表里消失。
(function () {
  const t = T('群聊列表');
  let hat = null;
  for (const id in t.blocks) {
    const b = t.blocks[id];
    if (b.opcode === 'event_whenbroadcastreceived' && b.fields.BROADCAST_OPTION && b.fields.BROADCAST_OPTION[0] === '退出群聊') hat = id;
  }
  if (!hat) throw new Error('补丁11: 群聊列表里没找到「退出群聊」接收器');
  const head = t.blocks[hat].next;
  if (!head) throw new Error('补丁11: 「退出群聊」下面没有块');
  const neg = notOf(t, eqConst(t, '当前显示的群聊ID', GID));
  const g = mkBlock(t, 'control_if', { CONDITION: [2, neg], SUBSTACK: [2, head] }, {});
  t.blocks[neg].parent = g;
  t.blocks[head].parent = g;
  link(t, hat, g);
  t.blocks[g].parent = hat;
  log.push('补丁11: MiniChat 群退出时不删群聊列表那一行（' + hat + '.next 改为守卫 ' + g + '）');
})();

// ---- 补丁 12：MiniChat 群里点退群，直接弹「无法退出」，不走确认框 ----
// 「退群」按钮第一步广播的是「退出群聊提示」，由「提示」弹出确认窗口 Rq；
// 用户确认之后才会广播「退出群聊」再走补丁9 那条路。既然 MiniChat 群根本不能退，
// 就在第一步直接换成我们的提示窗口，别让用户白确认一次。
(function () {
  const t = T('提示');
  let hat = null;
  for (const id in t.blocks) {
    const b = t.blocks[id];
    if (b.opcode === 'event_whenbroadcastreceived' && b.fields.BROADCAST_OPTION && b.fields.BROADCAST_OPTION[0] === '退出群聊提示') hat = id;
  }
  if (!hat) throw new Error('补丁12: 提示里没找到「退出群聊提示」接收器');
  const outer = t.blocks[hat].next;
  if (!outer) throw new Error('补丁12: 「退出群聊提示」下面没有块');
  const sv = t.blocks[outer].inputs && t.blocks[outer].inputs.SUBSTACK;
  if (!sv || typeof sv[1] !== 'string') throw new Error('补丁12: 第一块不是带 SUBSTACK 的控制块（' + t.blocks[outer].opcode + '）');
  const head = sv[1];

  const A_TITLE = '}z_7!=yrcNgOn8`SopS*';
  const A_CONTENT = '*~w+tlqibsN6@!Mid881';
  const A_YESNO = '0!R]u`PONbLh=wuo=jGR';
  const A_DARK = 'Aum]pFaWTN+i6tqkL^fh';
  const dialog = mkBlock(t, 'procedures_call', {
    [A_TITLE]:   [1, [10, '退出群聊']],
    [A_CONTENT]: [1, [10, '无法退出 MiniChat 群：它由桥接注入，在 FloxChat 服务器上并不存在。']],
    [A_YESNO]:   [1, [10, '1']],
    [A_DARK]:    [1, [10, '1']]
  }, {});
  t.blocks[dialog].mutation = {
    tagName: 'mutation', children: [],
    proccode: '创建窗口 | 标题 %s 内容 %s 包含“否”？ %s 暗色模式 %s',
    argumentids: JSON.stringify([A_TITLE, A_CONTENT, A_YESNO, A_DARK]),
    wasm: 'false'
  };

  const cond = eqConst(t, '当前显示的群聊ID', GID);
  const g = mkBlock(t, 'control_if_else', { CONDITION: [2, cond], SUBSTACK: [2, dialog], SUBSTACK2: [2, head] }, {});
  t.blocks[cond].parent = g;
  t.blocks[dialog].parent = g;
  t.blocks[head].parent = g;
  t.blocks[outer].inputs.SUBSTACK = [2, g];
  t.blocks[g].parent = outer;
  log.push('补丁12: MiniChat 群点退群直接弹提示，不走确认框（' + outer + '.SUBSTACK 从 ' + head + ' 改为 ' + g + '）');
})();

// ---- 补丁 10：MiniChat 群里点附件按钮不要往 FloxChat 上传 ----
// 附件走的是 httpfiletools（上传到 FloxChat 的 /upload）+ 一次 FloxChat 的发送请求。
// MiniChat 群里这两步都不该发生，改成只往聊天区放一条提示气泡。
(function () {
  const t = T('通讯');
  let up = null;
  for (const id in t.blocks) if (t.blocks[id].opcode === 'httpfiletools_uploadFile') up = id;
  if (!up) throw new Error('补丁10: 没找到 uploadFile');
  let cur = t.blocks[up].parent, guardIf = null, n = 0;
  while (cur && n < 40) {
    const b = t.blocks[cur];
    if (!b) break;
    if (b.opcode === 'control_if' || b.opcode === 'control_if_else') {
      const c = b.inputs && b.inputs.CONDITION;
      if (c && typeof c[1] === 'string' && JSON.stringify(t.blocks[c[1]]).indexOf('CommunicationUI13') >= 0) { guardIf = cur; break; }
    }
    cur = b.parent; n++;
  }
  if (!guardIf) throw new Error('补丁10: 没找到 CommunicationUI13 分支');
  const head = t.blocks[guardIf].inputs.SUBSTACK[1];
  const ln = '当前显示的群聊';
  // content 必须是 Base64（FloxChat 会 Encoding_decode 它），静态文案直接在这里编好
  const noticeText = '[MiniChat 群] 这里发不了文件/图片：附件上传走的是 FloxChat 服务器。文字消息可以直接发。';
  const notice = '{"username":"MiniChat","uid":"","avatar_url":"","content":"'
    + Buffer.from(noticeText, 'utf8').toString('base64')
    + '","time":"","mid":"attach"}';
  const note = mkBlock(t, 'data_addtolist', { ITEM: lit(notice) }, { LIST: [ln, listId(ln)] });
  const cond = eqConst(t, '当前显示的群聊ID', GID);
  const g = mkBlock(t, 'control_if_else', { CONDITION: [2, cond], SUBSTACK: [2, note], SUBSTACK2: [2, head] }, {});
  t.blocks[cond].parent = g;
  t.blocks[note].parent = g;
  t.blocks[head].parent = g;
  t.blocks[guardIf].inputs.SUBSTACK = [2, g];
  t.blocks[g].parent = guardIf;
  log.push('补丁10: ' + guardIf + '.SUBSTACK 改为「MiniChat 只提示不发送 / 其他群走原流程」');
})();

// ---- 补丁 5：注册扩展 ----
(function () {
  j.extensions = j.extensions || [];
  if (j.extensions.indexOf(EXT) === -1) j.extensions.push(EXT);
  j.extensionURLs = j.extensionURLs || {};
  j.extensionURLs[EXT] = EXT_URL;
  log.push('补丁5: extensions += ' + EXT + '，extensionURLs[' + EXT + '] -> ' + EXT_URL);
})();

fs.writeFileSync(dst, JSON.stringify(j), 'utf8');
console.log(log.join('\n'));
console.log('新增块数: ' + seq);


const fs = require('fs');
const src = process.argv[2];
const dst = process.argv[3];
const j = JSON.parse(fs.readFileSync(src, 'utf8'));
const EXT = 'minichatbridge';
const GID = 'MINICHAT';
const GNAME = 'MiniChat 群聊';
// 300px 版本：FloxChat 默认群头像就是 300x300，用它才能和别的群一样大
const GAVATAR = 'https://minichat.astras.cc/Floxchat-Bridge/minichat-logo-300.svg';
const EXT_URL = 'https://minichat.astras.cc/Floxchat-Bridge/minichat-bridge.js';
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
  // 找不到会返回 0，整行就会被顶到搜索框那一行。所以必须把 MINICHAT 也登记进「我所在的群聊」。
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
  const j2 = mkBlock(t, 'operator_join', { STRING1: [3, errRepB, [10, '']], STRING2: [1, [10, HALF2]] }, {});
  t.blocks[errRepB].parent = j2;
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
(function () {
  const t = T('消息显示');
  const f = findIfWithSubstackHead(t, 'gsaHTTPRequests_clearAll');
  if (!f) throw new Error('补丁3: 未找到 HTTP 分支');
  const neg = notOf(t, eqConst(t, '当前显示的群聊ID', GID));
  const g = mkBlock(t, 'control_if', { CONDITION: [2, neg], SUBSTACK: [2, f.headId] }, {});
  t.blocks[neg].parent = g;
  t.blocks[f.headId].parent = g;
  t.blocks[f.ifId].inputs.SUBSTACK = [2, g];
  t.blocks[g].parent = f.ifId;
  log.push('补丁3: ' + f.ifId + '.SUBSTACK 从 ' + f.headId + ' 改为 ' + g + ' (非 MiniChat 才走原 HTTP)');
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

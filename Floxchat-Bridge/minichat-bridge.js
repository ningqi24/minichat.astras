// Name: Minichat Bridge
// ID: minichatbridge
// Description: MiniChat.astras.cc 桥接扩展：登录、发送、接收、加载历史
// By: ningqi
(function(Scratch) {
  "use strict";

  var SUPABASE_URL = "https://xgugltiuszrpmbxjmqfv.supabase.co";
  var ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndWdsdGl1c3pycG1ieGptcWZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0ODE2MTUsImV4cCI6MjA5ODA1NzYxNX0.nWiJm_7Fh3-6MUdazhW7CwOAi8w2PVMsDbfhUNyUIsM";
  var EDGE_URL = "https://xgugltiuszrpmbxjmqfv.supabase.co/functions/v1/clever-task";
  var SECRET = "flox-meow-2024";

  var token = null;
  var userEmail = null;
  var userName = null;
  var userId = null;
  var socket = null;
  var refId = 0;
  var lastMsg = null;
  var lastError = null;
  var presenceMap = {};     // user_id -> {user_id,email,display_name,avatar_url,online_at}
  var presenceByEmail = {}; // email -> presence 对象（在线用户）

  // ---- 错误记录（让积木里的失败在 Scratch 里可见）----
  function setError(err) {
    lastError = (err && err.message) ? err.message : String(err);
    console.error("Bridge:", lastError);
  }
  function clearError() { lastError = null; }

  // ---- 口令说明 ----
  // 旧版本这里用 hashPwd(email) 在本地算口令并上送，属于"任何人都能凭邮箱推出密码"的设计，
  // 已废弃。现在口令完全由 Edge Function 用服务端密钥（MINICHAT_BRIDGE_PEPPER）派生，
  // 客户端不再发送也不再持有任何 password。

  // ---- 统一走 Edge Function（不带 Authorization 头，靠 secret + 登录 token 校验，绕开 Electron CORS bug）----
  function callEdge(action, payload) {
    var body = Object.assign({ action: action, secret: SECRET }, payload || {});
    // 除 login 外都自动携带登录 token（放 body 里，由 Edge 校验身份，防止伪造）
    if (token && action !== "login") {
      body.access_token = token;
    }
    // 加超时：Edge 冷启动 / 网络卡住时，绝不能让积木链永远挂在那里
    var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var tid = ctl ? setTimeout(function() { ctl.abort(); }, 12000) : null;
    var opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    };
    if (ctl) opts.signal = ctl.signal;
    var stopTimer = function() { if (tid) { clearTimeout(tid); tid = null; } };
    return fetch(EDGE_URL, opts).then(function(r) {
      stopTimer();
      return r.json();
    }).then(function(d) {
      if (d.error) throw new Error(d.error);
      return d;
    }).catch(function(e) {
      stopTimer();
      if (e && e.name === "AbortError") throw new Error("请求超时（12 秒无响应），请检查网络");
      throw e;
    });
  }

  // ---- 把 Edge 返回的会话落到本地状态 ----
  function applySession(d, fallbackEmail, fallbackName) {
    token = d.access_token;
    userEmail = d.email || fallbackEmail;
    userName = d.display_name || (fallbackName || (fallbackEmail || "").split("@")[0]);
    userId = d.user_id || null;
    return d;
  }

  // ---- 登录拿 JWT（仅对已有 MiniChat 账号；账号不存在会返回 ACCOUNT_NOT_FOUND）----
  function getToken(email, name) {
    return callEdge("login", {
      email: email,
      display_name: name || email.split("@")[0]
    }).then(function(d) {
      return applySession(d, email, name);
    });
  }

  // ---- 清空当前会话 ----
  // ⚠️ 切换 FloxChat 账号时必须先清掉上一段会话。
  // 否则新账号连接失败时（比如这个账号还没开通 MiniChat，会返回 ACCOUNT_NOT_FOUND），
  // 旧的 token 会留在内存里，之后发的消息就全算到上一个账号头上了。
  function resetSession() {
    token = null;
    userEmail = null;
    userName = null;
    userId = null;
    presenceMap = {};
    presenceByEmail = {};
    ext._usersCache = null;
    ext._lastMsg = null;
    ext._historyCache = null;
    ext._floxSeen = {};
    ext._floxLastTs = "";
    lastMsg = null;
    if (socket) { try { socket.close(); } catch (e) {} socket = null; }
    stopTimer();
    floxPages = [];
    floxLoadedCount = 0;
    floxNewSinceLoad = 0;
    floxExhausted = false;
  }

  // ---- 发送 FloxChat 验证码（走 Edge Function 代理，避免 TurboWarp 里的 CORS 拦截）----
  function sendFloxCode(email) {
    return callEdge("flox_send_code", { email: email });
  }

  // ---- 用 FloxChat 验证码登录；首次会自动开通 MiniChat 账号 ----
  function loginWithFloxCode(email, code) {
    return callEdge("flox_code_login", { email: email, code: code }).then(function(d) {
      return applySession(d, email, "");
    });
  }

  // ===================== FloxChat 兼容层 =====================
  // FloxChat 的聊天界面是「数据驱动」的，它只认这两种 JSON 对象形状：
  //   群聊对象 {"gid","name","avatar_url"}
  //   消息对象 {"username","uid","avatar_url","content","time","mid"}
  // 只要把 MiniChat 的数据按这个形状写进它的列表，FloxChat 现有的气泡/滚动/头像 UI
  // 就会直接渲染，不需要重画界面。
  // FloxChat 群聊 ID 统一 7 位（GID+4位数字 / FLOXGRP / SAYLINK）
  var BRIDGE_VERSION = "v10";
  var FLOX_GID = "MINCHAT";
  var FLOX_GROUP_NAME = "MiniChat 群聊";
  var FLOX_GROUP_AVATAR = "https://minichat.astras.cc/Floxchat-Bridge/minichat-avatar-150.svg";

  function avatarByEmail() {
    var map = {};
    var users = ext._usersCache || [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      // 没有自定义头像的用户要给个默认图 —— 传空字符串的话 FloxChat 加载不出皮肤，
      // 对话框里就会显示成精灵自带的小方块。
      if (u && u.email) map[String(u.email).toLowerCase()] = u.avatar_url || getDefaultAvatar(u.email);
    }
    return map;
  }

  // ---- 头像归一化：FloxChat 的头像规格是 150x150 正方形 ----
  // FloxChat 用「设为 N% 大小」来缩放头像，而 N% 是相对图片【自然尺寸】的百分比，
  // 所以图片本身多大就直接决定显示多大。这里在读取端把任意来源的头像
  //（包括历史上传的、尺寸各异的）统一裁成 150x150 再交给 FloxChat，
  // 存量头像完全不用重新上传。
  // ⚠️ 这个尺寸只影响【消息气泡里的用户头像】（归一化后的 data URI）。
  // 群聊列表里那个 MiniChat 群头像是补丁注入的静态 SVG，跟这里无关。
  // FloxChat 用「set size to (20 × 放大系数)%」画它 —— 实测 150 偏小，调到 300。
  var FLOX_AVATAR_SIZE = 300;
  // 头像规范化「最长等多久」。超时就用原图先顶上 —— 绝不能让某张图下载慢
  // 把整条消息链路堵死（之前就是这么卡住的）。
  var FLOX_AVATAR_TIMEOUT = 2000;
  // v2：v1 把透明头像压成了 JPEG 白底，必须作废旧缓存
  var FLOX_AVATAR_CACHE_KEY = "minichat_bridge_avatars_v3";   // v3：头像尺寸 150 -> 300
  var floxAvatarCache = {};     // 原地址 -> 150x150 的 data URI
  var floxAvatarPending = {};

  // 结果持久化：同一张头像只需要下载+处理一次，之后再打开工程是秒出
  try {
    var cachedRaw = localStorage.getItem(FLOX_AVATAR_CACHE_KEY);
    if (cachedRaw) floxAvatarCache = JSON.parse(cachedRaw) || {};
  } catch (e) {}

  var floxAvatarSaveTimer = null;
  function saveAvatarCache() {
    if (floxAvatarSaveTimer) return;
    floxAvatarSaveTimer = setTimeout(function() {
      floxAvatarSaveTimer = null;
      try {
        var keys = Object.keys(floxAvatarCache);
        if (keys.length > 300) keys = keys.slice(-300);
        var out = {}, bytes = 0;
        for (var i = keys.length - 1; i >= 0; i--) {
          var v = floxAvatarCache[keys[i]];
          if (!v || bytes + v.length > 2000000) break;   // 上限 2MB，别撑爆 localStorage
          out[keys[i]] = v; bytes += v.length;
        }
        localStorage.setItem(FLOX_AVATAR_CACHE_KEY, JSON.stringify(out));
      } catch (e) {}
    }, 800);
  }

  function normalizeAvatar(url) {
    url = String(url == null ? "" : url);
    if (!url) return Promise.resolve("");
    if (floxAvatarCache[url]) return Promise.resolve(floxAvatarCache[url]);
    if (floxAvatarPending[url]) return floxAvatarPending[url];
    floxAvatarPending[url] = new Promise(function(resolve) {
      var done = function(v) { floxAvatarCache[url] = v; resolve(v); };
      try {
        var img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function() {
          try {
            var n = FLOX_AVATAR_SIZE;
            var iw = img.naturalWidth || img.width;
            var ih = img.naturalHeight || img.height;
            var s = Math.min(iw, ih);                 // 居中正方形裁剪
            var c = document.createElement("canvas");
            c.width = n; c.height = n;
            var ctx = c.getContext("2d");
            ctx.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, n, n);
            // 有透明像素就必须用 PNG：JPEG 会把透明区域拍成白底，
            // 默认头像那种透明图会变成一块白方块。
            done(canvasHasAlpha(ctx, n) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.85));
          } catch (e) {
            done(url);                                // 画布被污染（跨域）等 -> 退回原图
          }
        };
        img.onerror = function() { done(url); };
        img.src = url;
      } catch (e) { done(url); }
    });
    return floxAvatarPending[url];
  }

  // 只规范化「这批消息真正用到」的头像，并且限时等待。
  // 注意别写成「把整张用户表的头像全下一遍」——用户一多就会卡到消息都出不来。
  function normalizeAvatarsFor(avatars, emails) {
    var seen = {}, list = [];
    for (var i = 0; i < emails.length; i++) {
      var u = avatars[String(emails[i] == null ? "" : emails[i]).toLowerCase()];
      if (u && !floxAvatarCache[u] && !seen[u]) { seen[u] = 1; list.push(u); }
    }
    if (!list.length) return Promise.resolve();
    var all = Promise.all(list.map(function(u) { return normalizeAvatar(u); }));
    return new Promise(function(resolve) {
      var done = false;
      var finish = function() {
        if (done) return;
        done = true;
        saveAvatarCache();
        resolve();
      };
      setTimeout(finish, FLOX_AVATAR_TIMEOUT);   // 兜底：到点就走，不等了
      all.then(finish, finish);
    });
  }

  function senderEmails(msgs) {
    var out = [];
    for (var i = 0; i < msgs.length; i++) out.push(msgs[i] && msgs[i].sender_email);
    return out;
  }

  function floxAvatarOf(avatars, email) {
    var u = avatars[String(email).toLowerCase()] || "";
    return (u && floxAvatarCache[u]) ? floxAvatarCache[u] : u;
  }

  // MiniChat 的附件/引用标记在 FloxChat 里没法渲染，换成可读文字
  function floxText(content) {
    return String(content == null ? "" : content)
      .replace(/!\[image\]\(([^)]+)\)/g, "[图片] $1")
      .replace(/\[audio\]\(([^)]+)\)/g, "[语音] $1")
      .replace(/\[video\]\(([^)]+)\)/g, "[视频] $1")
      .replace(/\[file\]\(([^)|]+)(?:\|[^)]*)?\)/g, "[文件] $1")
      .replace(/\[quote:[^\]]*\]/g, "[引用]");
  }

  // FloxChat 渲染时是 Encoding_decode(Base64, content) —— 它把 content 当 Base64 解。
  // 所以写进去之前必须先编码，否则明文会被解成乱码。
  function floxBase64(str) {
    try {
      var bytes = new TextEncoder().encode(String(str == null ? "" : str));
      var bin = "";
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    } catch (e) { return ""; }
  }

  // FloxChat 直接把 time 当字符串显示（它自己的消息是「09:01」这种短格式），
  // 不做任何格式化，所以要在这里把 ISO 时间转成本地 HH:MM。
  function floxTime(iso) {
    var d = new Date(String(iso == null ? "" : iso));
    if (isNaN(d.getTime())) return String(iso || "");
    var hh = d.getHours(), mm = d.getMinutes();
    return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
  }

  // 抽样判断画布有没有透明像素
  function canvasHasAlpha(ctx, n) {
    try {
      var d = ctx.getImageData(0, 0, n, n).data;
      for (var i = 3; i < d.length; i += 4 * 31) {   // 每 31 个像素抽一个
        if (d[i] < 250) return true;
      }
      return false;
    } catch (e) { return true; }
  }

  function toFloxMessage(m, avatars) {
    var email = String(m.sender_email || "");
    return JSON.stringify({
      username: m.sender_name || (email ? email.split("@")[0] : ""),
      uid: email,
      avatar_url: floxAvatarOf(avatars, email),
      content: floxBase64(floxText(m.content)),
      time: floxTime(m.created_at),
      mid: m.id || ""
    });
  }

  // 把「自上次以来新增的」MiniChat 消息追加到目标列表。
  // 注意是「只追加」而不是「整表替换」：FloxChat 靠 len(列表) - len(已显示消息) 决定渲染几条，
  // 列表一旦不再变长，后面所有新消息就永远不会显示出来。
  // ⚠️ 这个函数是「发射后不管」调用的，如果短时间内被调用两次（连点两次群聊、
  // 或者连接与回填交叉），两次都会看到 _floxLastTs 为空 → 各自整批追加一遍，
  // 列表头部就会多出一模一样的重复条目。用这个闸门保证同一时刻只跑一次。
  var floxBackfillInFlight = false;

  function appendFloxMessages(listName) {
    var list = findList(listName);
    if (!list) throw new Error("找不到列表「" + listName + "」：请先在 Scratch 里创建同名列表，并在积木下拉里选中它");
    if (floxBackfillInFlight) return Promise.resolve(0);
    floxBackfillInFlight = true;
    var finish = function() { floxBackfillInFlight = false; };
    ext._floxSeen = ext._floxSeen || {};
    var backfill = !ext._floxLastTs;
    var prep = ext._usersCache ? Promise.resolve() : (ext.loadUsers() || Promise.resolve());
    return prep.then(function() {
      return loadHistory(60);    // 最旧 → 最新（实时推送兜底，60 条足够补差）
    }).then(function(msgs) {
      var avatars = avatarByEmail();
      var start = backfill ? Math.max(0, msgs.length - 30) : 0;
      // 只规范化这次真的要渲染的那几条消息的发送者头像
      return normalizeAvatarsFor(avatars, senderEmails(msgs.slice(start))).then(function() {
        var added = 0;
        for (var i = start; i < msgs.length; i++) {
          var m = msgs[i];
          var id = String(m.id || "");
          if (id && ext._floxSeen[id]) continue;
          var t = String(m.created_at || "");
          if (!id && ext._floxLastTs && t && t <= ext._floxLastTs) continue;
          list.value.push(toFloxMessage(m, avatars));
          if (id) ext._floxSeen[id] = 1;
          if (t) ext._floxLastTs = t;
          added++;
        }
        finish();
        return added;
      });
    }).catch(function(e) { finish(); throw e; });
  }

  // ---- 自动推送：新消息一到就直接追加进目标列表，FloxChat 下一秒的刷新循环自会渲染 ----
  // 这样完全不需要轮询 MiniChat，也不会消耗 Edge Function 的调用额度。
  var floxAutoList = null;

  function floxAutoPushToList(msg) {
    if (!floxAutoList || !msg) return Promise.resolve();
    // 新消息始终追加到尾部（列表本来就是旧→新），但要记一笔：
    // 取页用的 offset 是「从最新往回数」，来了新消息这个基准就前移了。
    // （floxNewSinceLoad 在每次取页时归零）
    var list = findList(floxAutoList);
    if (!list) return Promise.resolve();
    ext._floxSeen = ext._floxSeen || {};
    var id = String(msg.id || "");
    if (id) {
      if (ext._floxSeen[id]) return Promise.resolve();
      ext._floxSeen[id] = 1;
    }
    var avatars = avatarByEmail();
    // 实时推送这条：只等它的发送者头像，且限时；超时就先用原图，不耽误出消息
    return normalizeAvatarsFor(avatars, [msg.sender_email]).then(function() {
      list.value.push(toFloxMessage(msg, avatars));
      floxNewSinceLoad++;
      if (msg.created_at) ext._floxLastTs = String(msg.created_at);
    });
  }

  // 往 FloxChat 的群聊列表里塞一个「MiniChat」条目（幂等）
  function injectFloxGroup(listName) {
    var list = findList(listName);
    if (!list) throw new Error("找不到列表「" + listName + "」：请先在 Scratch 里创建同名列表，并在积木下拉里选中它");
    for (var i = 0; i < list.value.length; i++) {
      var raw = list.value[i];
      try { if (String(JSON.parse(raw).gid) === FLOX_GID) return 0; } catch (e) {}
      if (String(raw).indexOf(FLOX_GID) !== -1) return 0;
    }
    list.value.push(JSON.stringify({
      gid: FLOX_GID,
      name: FLOX_GROUP_NAME,
      avatar_url: FLOX_GROUP_AVATAR
    }));
    return 1;
  }

  // ---- WebSocket 实时接收（走 apikey 参数，不受 CORS 影响）----
  function connectWS() {
    if (socket) { socket.close(); }
    var url = "wss://xgugltiuszrpmbxjmqfv.supabase.co/realtime/v1/websocket?apikey="
      + encodeURIComponent(ANON_KEY) + "&vsn=1.0.0";
    socket = new WebSocket(url);
    socket.onopen = function() {
      var ref = String(++refId);
      socket.send(JSON.stringify({
        topic: "realtime:public:messages",
        event: "phx_join",
        payload: {
          access_token: token,
          config: {
            broadcast: { self: true },
            postgres_changes: [
              { event: "INSERT", schema: "public", table: "messages" }
            ]
          }
        },
        ref: ref
      }));
      // 同一连接再加入在线状态(presence)频道
      joinPresence();
    };
    socket.onmessage = function(e) {
      try {
        var m = JSON.parse(e.data);
        // 在线状态事件：presence_state / presence_diff
        if (m.topic === "presence-global") {
          if (m.event === "presence_state") {
            presenceMap = {};
            var st = m.payload || {};
            for (var k in st) {
              var p = (st[k] || [])[0];
              if (p) presenceMap[k] = normalizePresence(k, p);
            }
            rebuildPresenceByEmail();
          } else if (m.event === "presence_diff") {
            var pl = m.payload || {};
            for (var jk in (pl.joins || {})) {
              var pj = (pl.joins[jk] || [])[0];
              if (pj) presenceMap[jk] = normalizePresence(jk, pj);
            }
            for (var lk in (pl.leaves || {})) delete presenceMap[lk];
            rebuildPresenceByEmail();
          }
          return;
        }
        if (m.payload && m.payload.data && m.payload.data.record) {
          onBridgeMessage(m.payload.data.record);
        }
      } catch(_) {}
    };
    socket.onclose = function() {
      if (token) { setTimeout(connectWS, 5000); }
    };
  }

  // ---- 收到新消息的统一入口（扩展加载时只注册一次，避免回调无限增长）----
  function onBridgeMessage(msg) {
    lastMsg = msg;
    var fire = function() {
      if (Scratch.vm && Scratch.vm.runtime) {
        Scratch.vm.runtime.startHats("minichatbridge_whenReceived");
      }
    };
    if (!floxAutoList) { fire(); return; }
    // 先把头像规范化再推进列表，保证 FloxChat 渲染时数据已经就位
    Promise.resolve()
      .then(function() { return floxAutoPushToList(msg); })
      .catch(function() {})
      .then(fire);
  }

  // ---- 在线状态(presence)：加入 presence-global 频道并维护在线用户表 ----
  function normalizePresence(key, p) {
    return {
      user_id: p.user_id || key,
      email: p.email || "",
      display_name: p.display_name || "",
      avatar_url: p.avatar_url || "",
      online_at: p.online_at || ""
    };
  }
  function rebuildPresenceByEmail() {
    presenceByEmail = {};
    for (var k in presenceMap) {
      var p = presenceMap[k];
      if (p && p.email) presenceByEmail[p.email] = p;
    }
  }
  function joinPresence() {
    if (!socket || !userId) return;
    socket.send(JSON.stringify({
      topic: "presence-global",
      event: "phx_join",
      payload: {
        access_token: token,
        config: { presence: { key: userId } }
      },
      ref: String(++refId)
    }));
  }

  // ---- 发消息（走 Edge Function）----
  function sendMsg(text) {
    return callEdge("send_message", {
      content: text,
      sender_email: userEmail,
      sender_name: userName
    });
  }

  // ---- 加载最近 N 条历史（新到旧取，再反转为从早到晚）----
  function loadHistory(limit) {
    return callEdge("get_messages", { limit: limit || 30 })
      .then(function(d) { return (d.messages || []).reverse(); });
  }

  // ---- 一次性加载全部历史消息（分页拉取，按时间从早到晚）----
  function loadAllHistory() {
    var PAGE = 1000;
    var all = [];
    function fetchPage(from) {
      return callEdge("get_messages", { limit: PAGE, offset: from })
        .then(function(d) {
          var msgs = d.messages || [];
          all = all.concat(msgs);
          if (msgs.length < PAGE) return all;
          return fetchPage(from + PAGE);
        });
    }
    return fetchPage(0).then(function(msgs) { return msgs.reverse(); });
  }

  // ---- 历史消息分页 ----
  // FloxChat 的渲染是「只往尾部追加」的：刷新数 = len(当前显示的群聊) - len(已显示消息)。
  // 所以往前翻历史不能 unshift（下标全乱），而要【整表替换】+ 广播一次「刷新消息」——
  // 那个广播的处理器会把 已显示消息 / 消息长度 / i 等全归零，下一秒从头重画整页。
  var FLOX_PAGE_SIZE = 30;        // 每次往前取多少条
  var FLOX_MAX_LOADED = 120;      // 累积上限：渲染 0.07 秒/条 + 每条约一组克隆体，再多就卡了
  var floxPages = [];             // 已加载的页，每页都是「旧→新」，floxPages[0] 是最老的一页
  var floxLoadedCount = 0;        // 已累积条数（从最新往回数）
  var floxNewSinceLoad = 0;       // 上次取页之后又实时推了几条（校正 offset 用）
  var floxExhausted = false;      // 已经拉到头了（没有更早的消息）
  var floxPageBusy = false;

  function floxTargetList() {
    return floxAutoList ? findList(floxAutoList) : null;
  }

  // 连接是异步的：刚 resetSession 过、或者还在登录中时 token 还是空的。
  // 直接取页会被 floxLoadPage 的前置检查挡掉，进群第一屏就一直是空的。
  // 所以这里等一小会儿，等会话就绪再取页。
  // 把错误直接作为一条气泡追加进目标列表（补丁里那个检查时机太早：
  // 「桥接直接连接」是异步的，查 桥接最后错误 时错误还没产生，所以看不到）
  function floxAppendErrorBubble(text) {
    try {
      var list = floxTargetList();
      if (!list) return;
      var t = String(text || lastError || "");
      if (!t) return;
      list.value.push(JSON.stringify({
        username: "MiniChat 桥接",
        uid: "",
        avatar_url: "",
        content: floxBase64(t),
        time: "",
        mid: "bridge-err-" + Date.now()
      }));
    } catch (e) {}
  }

  function floxWaitSession(timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 12000);
    return new Promise(function(resolve) {
      (function poll() {
        if (token && userEmail) return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        setTimeout(poll, 200);
      })();
    });
  }

  // 一条消息会生成一组克隆体，Scratch 默认上限 300 很快会被打满，顺手抬高一些
  function floxRaiseCloneLimit(n) {
    try {
      var ro = Scratch.vm.runtime.runtimeOptions;
      if (ro && (typeof ro.maxClones !== "number" || ro.maxClones < n)) ro.maxClones = n;
    } catch (e) {}
  }

  // 把已加载的所有页摊平（旧→新）
  function floxFlatten() {
    var all = [];
    for (var p = 0; p < floxPages.length; p++) {
      for (var i = 0; i < floxPages[p].length; i++) all.push(floxPages[p][i]);
    }
    return all;
  }

  // 取一页并铺进列表，然后让 FloxChat 从头重画
  //   mode = "reset"：从最新开始（进群 / 回最新）
  //   mode = "more" ：往更早累积一页
  function floxLoadPage(offset, mode) {
    if (!token || !userEmail) { setError("未连接，请先「桥接连接」"); return Promise.resolve(-1); }
    if (floxPageBusy) return Promise.resolve(-1);
    var list = floxTargetList();
    if (!list) { setError("还没进入 MiniChat 群（自动推送未开启）"); return Promise.resolve(-1); }
    if (!(offset >= 0)) offset = 0;
    floxPageBusy = true;
    floxRaiseCloneLimit(1500);
    // ⚠️ 必须先拿到用户表，否则 avatarByEmail() 是空的 -> 头像 URL 全空 -> 头像不显示
    var prep = ext._usersCache ? Promise.resolve() : (ext.loadUsers() || Promise.resolve());
    return prep.then(function() {
      return callEdge("get_messages", { limit: FLOX_PAGE_SIZE, offset: offset });
    }).then(function(d) {
      var page = (d.messages || []).slice().reverse();     // 服务端是「新→旧」，翻转成「旧→新」
      if (mode === "reset") {
        floxPages = [];
        floxLoadedCount = 0;
        floxExhausted = false;
      }
      if (!page.length) {
        floxExhausted = true;
      } else {
        floxPages.unshift(page);                          // 更老的一页放到最前面
        floxLoadedCount += page.length;
        if (page.length < FLOX_PAGE_SIZE) floxExhausted = true;
      }
      floxNewSinceLoad = 0;                             // 取页后基准重新锚定
      var all = floxFlatten();
      var avatars = avatarByEmail();
      return normalizeAvatarsFor(avatars, senderEmails(all)).then(function() {
        list.value.length = 0;                            // 整表替换成「已加载的全部」
        for (var i = 0; i < all.length; i++) list.value.push(toFloxMessage(all[i], avatars));
        ext._floxSeen = {};
        ext._floxLastTs = "";
        clearError();
        // 让 FloxChat 自己把整个列表从头画出来（和它自己点群聊时用的是同一套机制）
        try {
          Scratch.vm.runtime.startHats("event_whenbroadcastreceived", { BROADCAST_OPTION: "刷新消息" });
        } catch (e) {}
        return floxLoadedCount;
      });
    }).then(function(n) { floxPageBusy = false; return n; },
            function(e) { floxPageBusy = false; setError(e); return -1; });
  }

  function floxLoadMore() {
    if (floxExhausted) return Promise.resolve(-1);
    if (floxLoadedCount >= FLOX_MAX_LOADED) return Promise.resolve(-1);
    // 已连续加载了 N 条（加上期间实时推来的），下一页就从那里开始
    return floxLoadPage(floxLoadedCount + floxNewSinceLoad, "more");
  }

  // ---- 自动翻页：盯着 FloxChat 的「滑动页面」，用户一滚动就自动往前多加载一页 ----
  // 重画后 FloxChat 自己会把 滑动页面 归位（它的「刷新消息」处理器里写死 55），
  // 所以加载完要等几秒再接受下一次触发，否则会被自己归位的动作反复触发。
  var FLOX_AUTOPAGE_COOLDOWN = 3000;      // 每次加载后的冷却（渲染要几秒，别叠着来）
  var FLOX_AUTOPAGE_INTERVAL = 6000;      // 定时自动加载的间隔
  var floxScrollWatch = null;
  var floxLastScroll = null;
  var floxScrollCooldown = 0;

  function findVar(name) {
    try {
      var targets = Scratch.vm.runtime.targets;
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (t && t.stage === true && t.lookupVariableByNameAndType) {
          var v = t.lookupVariableByNameAndType(name, "variable");
          if (v) return v;
        }
      }
      for (var j = 0; j < targets.length; j++) {
        var t2 = targets[j];
        if (t2 && t2.lookupVariableByNameAndType) {
          var v2 = t2.lookupVariableByNameAndType(name, "variable");
          if (v2) return v2;
        }
      }
    } catch (e) {}
    return null;
  }

  function floxCanAutoLoad() {
    if (floxPageBusy) return false;
    if (floxExhausted) return false;
    if (floxLoadedCount >= FLOX_MAX_LOADED) return false;
    if (!floxAutoList || !token) return false;
    if (Date.now() < floxScrollCooldown) return false;
    return true;
  }

  function floxAutoTick() {
    if (!floxCanAutoLoad()) return;
    floxScrollCooldown = Date.now() + FLOX_AUTOPAGE_COOLDOWN;
    floxLoadMore();
  }

  // 自动翻页有两条触发：
  //   ① 定时：每 FLOX_AUTOPAGE_INTERVAL 毫秒自动往前多加载一页，直到拉完或到上限
  //      （FloxChat 的聊天页是用【方向键】滚的，不是鼠标滚轮 —— 不能只等滚动事件）
  //   ② 滚动：FloxChat 按一次上/下箭头会让「滑动页面」变 ±80，变化了就顺带加载
  var floxAutoTimer = null;

  function floxStartAutoPage() {
    if (!floxAutoTimer) {
      floxAutoTimer = setInterval(function() {
        try { floxAutoTick(); } catch (e) {}
      }, FLOX_AUTOPAGE_INTERVAL);
    }
    if (floxScrollWatch) return;
    floxLastScroll = null;
    floxScrollCooldown = 0;
    floxScrollWatch = setInterval(function() {
      try {
        if (!floxCanAutoLoad()) return;
        var sv = findVar("滑动页面");
        if (!sv) return;
        var cur = Number(sv.value);
        if (!isFinite(cur)) return;
        if (floxLastScroll === null) { floxLastScroll = cur; return; }
        if (Math.abs(cur - floxLastScroll) < 40) { floxLastScroll = cur; return; }
        floxLastScroll = cur;
        floxAutoTick();
      } catch (e) {}
    }, 300);
  }

  function floxStopAutoPage() {
    if (floxScrollWatch) { clearInterval(floxScrollWatch); floxScrollWatch = null; }
    if (floxAutoTimer) { clearInterval(floxAutoTimer); floxAutoTimer = null; }
    floxLastScroll = null;
  }

  // ---- 提取文件/图片/视频/音频消息中的链接 ----
  function extractUrl(content) {
    if (!content) return "";
    var m = content.match(/^\[(?:file|video|audio)\]\((.+?)(?:\|.*)?\)$/);
    if (m) return m[1];
    m = content.match(/^!\[.*?\]\((.+?)\)$/);
    if (m) return m[1];
    m = content.match(/^\[.*?\]\((.+?)\)$/);
    if (m) return m[1];
    return content;
  }

  // ---- 默认头像（与前端 index.html 同款兜底算法）----
  function getDefaultAvatar(email) {
    return "https://ui-avatars.com/api/?name=" +
      encodeURIComponent(email ? email.split("@")[0] : "用户") +
      "&background=3b82f6&color=fff&size=128&bold=true";
  }

  // ---- 查找 Scratch 列表（跨所有角色与舞台，数字等特殊命名也能识别） ----
  function findList(name) {
    // 统一转成字符串并去空格：防止纯数字等特殊命名在类型转换后匹配失败
    name = Scratch.Cast.toString(name).trim();
    var targets = Scratch.vm.runtime.targets;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (!t) continue;
      if (t.lookupVariableByNameAndType) {
        var v = t.lookupVariableByNameAndType(name, "list");
        if (v) return v;
      }
      // 兜底：直接遍历变量表做宽松匹配
      if (t.variables) {
        for (var id in t.variables) {
          var varObj = t.variables[id];
          if (varObj && varObj.type === "list" && String(varObj.name).trim() === name) {
            return varObj;
          }
        }
      }
    }
    return null;
  }

  // ---- 解析列表条目文本：JSON → 旧格式「名字（邮箱）：内容」→ 原文兜底 ----
  function parseEntryText(item, field) {
    var raw = item;
    if (Array.isArray(raw)) {
      raw = raw.length > 0 ? raw[0] : "";
    }
    var text = Scratch.Cast.toString(raw).trim();
    var o = null;
    try { o = JSON.parse(text); } catch(_) {}
    if (o && typeof o === "object") {
      // 通用取字段：name/email/content/avatar/online/last_login 均可
      var v = o[field];
      return (v === undefined || v === null) ? "" : v;
    }
    var m = text.match(/^(.+?)（(.+?)）：(.*)$/);
    if (m) {
      if (field === "name") return m[1];
      if (field === "email") return m[2];
      if (field === "content") return m[3];
      return "";
    }
    return field === "content" ? text : "";
  }

  // ---- Scratch 积木 ----
  var ext = {
    _lastMsg: null,
    _historyCache: null,
    _usersCache: null,
    _lastCodeEmail: "",
    _floxSeen: null,
    _floxLastTs: "",

    connect: function(args) {
      var email = String(args.EMAIL || "").trim();
      if (!email) {
        setError("请输入邮箱后再「桥接连接」");
        return;
      }
      clearError();
      // 只有换账号才清会话：同账号重进没必要重新登录，
      // 而且清了 token 之后紧接着的取页会拿不到会话（进群第一屏就是空的）。
      if (String(email).toLowerCase() !== String(userEmail || "").toLowerCase()) resetSession();
      return getToken(email, args.NAME).then(function() {
        connectWS();
      }).catch(function(e) {
        setError(e);
        floxAppendErrorBubble(e && e.message ? e.message : e);   // 连不上要能看见原因
      });
    },

    // 给指定邮箱发一封 FloxChat 验证码（首次开通账号用）
    sendFloxCode: function(args) {
      var email = String(args.EMAIL || "").trim();
      if (!email) { setError("请先填写邮箱"); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("邮箱格式不正确：" + email); return; }
      clearError();
      return sendFloxCode(email).then(function() {
        ext._lastCodeEmail = email;
      }).catch(function(e) {
        setError(e);
      });
    },

    // 用验证码登录；账号不存在时由服务端自动开通
    connectByCode: function(args) {
      var email = String(args.EMAIL || "").trim() || ext._lastCodeEmail || "";
      var code = String(args.CODE || "").trim();
      if (!email) { setError("请先填写邮箱"); return; }
      if (!code) { setError("请填写收到的验证码"); return; }
      clearError();
      if (String(email).toLowerCase() !== String(userEmail || "").toLowerCase()) resetSession();
      return loginWithFloxCode(email, code).then(function() {
        connectWS();
      }).catch(function(e) {
        setError(e);
        floxAppendErrorBubble(e && e.message ? e.message : e);
      });
    },

    send: function(args) {
      if (!token || !userEmail) {
        setError("未连接，请先「桥接连接」");
        return;
      }
      // 历史翻页命令：在 MiniChat 群里发这些词就当翻页，不真的发出去
      // （MiniChat 群的发送本来就只走扩展，所以在这里拦最省事、不用加任何 UI）
      var cmd = String(args.MSG == null ? "" : args.MSG).trim();
      if (/^(↑|\.\.|\/older|\/old|\/more|\/up|更早|\/更早)$/.test(cmd)) {
        floxLoadMore();
        return;
      }
      if (/^(↓|\/newer|\/new|\/latest|\/down|最新|\/最新)$/.test(cmd)) {
        floxLoadPage(0, "reset");
        return;
      }
      clearError();
      sendMsg(String(args.MSG || "")).catch(function(e) {
        setError(e);
      });
    },

    // ===== FloxChat 兼容 =====
    floxInjectGroup: function(args) {
      clearError();
      try { injectFloxGroup(args.LIST); } catch (e) { setError(e); }
    },

    floxRefreshMessages: function(args) {
      if (!token || !userEmail) {
        setError("未连接，请先「桥接连接」或「用验证码登录」");
        return;
      }
      clearError();
      return appendFloxMessages(args.LIST).catch(function(e) {
        setError(e);
      });
    },

    floxGroupId: function() { return FLOX_GID; },

    floxAutoPush: function(args) {
      clearError();
      var name = Scratch.Cast.toString(args.LIST || "").trim();
      if (!name) { setError("请先在积木下拉里选择列表"); return; }
      if (!findList(name)) { setError("找不到列表「" + name + "」：请先在 Scratch 里创建同名列表"); return; }
      floxAutoList = name;
      ext._floxSeen = ext._floxSeen || {};
      // 首次开启先回填一次，避免刚进聊天页是空的。
      // 注意这里是「发射后不管」：不回传 promise，FloxChat 的脚本不会卡在这一步，
      // 消息由它每秒的刷新循环自然渲染出来。
      // 进入群时整页加载（而不是尾部追加）：翻页的起点才明确。
      // 注意不能在这里判断 token —— 刚 connect 过时它还是空的，
      // 那样整段加载会被跳过（表现就是「一直在加载中，内容不出来」）。
      floxStartAutoPage();
      floxWaitSession(12000).then(function(ok) {
        if (!ok) {
          setError("等待连接超时：请确认已登录，且该邮箱已开通 MiniChat 账号");
          floxAppendErrorBubble(lastError);
          return;
        }
        floxLoadPage(0, "reset").then(function(n) {
          if (n === -1) floxAppendErrorBubble(lastError);   // 加载失败也把原因显示出来
        });
      });
    },

    floxAutoPushOff: function() {
      floxAutoList = null;
      floxStopAutoPage();
      clearError();
    },

    floxResetCursor: function() {
      ext._floxSeen = {};
      ext._floxLastTs = "";
      clearError();
    },

    // ---- 历史翻页（整表替换 + 让 FloxChat 重画）----
    floxLoadOlder: function() {
      return floxLoadMore();
    },
    floxLoadNewest: function() {
      return floxLoadPage(0, "reset");
    },
    floxPageIndex: function() {
      return floxLoadedCount;
    },
    floxHasMore: function() {
      return !floxExhausted && floxLoadedCount < FLOX_MAX_LOADED;
    },

    loadMessages: function(args) {
      if (!token) {
        setError("未连接，请先「桥接连接」");
        return;
      }
      clearError();
      return loadHistory(args.LIMIT || 30).then(function(msgs) {
        ext._historyCache = msgs;
      }).catch(function(e) {
        setError(e);
      });
    },

    loadAllMessages: function() {
      if (!token) {
        setError("未连接，请先「桥接连接」");
        return;
      }
      clearError();
      return loadAllHistory().then(function(msgs) {
        ext._historyCache = msgs;
      }).catch(function(e) {
        setError(e);
      });
    },

    historyCount: function() {
      return ext._historyCache ? ext._historyCache.length : 0;
    },

    historyLoaded: function() {
      return !!ext._historyCache;
    },

    historyItem: function(args) {
      var i = (args.INDEX || 1) - 1;
      var msgs = ext._historyCache || [];
      if (i < 0 || i >= msgs.length) return "";
      var m = msgs[i];
      if (args.FIELD === "sender") return m.sender_name || "";
      if (args.FIELD === "content") return extractUrl(m.content);
      if (args.FIELD === "time") return m.created_at || "";
      return "";
    },

    setListToMessages: function(args) {
      var name = Scratch.Cast.toString(args.LIST).trim() || "消息列表";
      var list = findList(name);
      if (!list) {
        setError("找不到列表「" + name + "」：请先在 Scratch 里创建同名列表，并在积木下拉菜单里选中它");
        return;
      }
      if (!ext._historyCache) {
        setError("尚未加载历史消息：请先执行「桥接加载 [LIMIT] 条历史消息」或「桥接加载全部历史消息」");
        return;
      }
      var msgs = ext._historyCache;
      var rows = [];
      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        // JSON 自转义：名字/邮箱/内容里出现任何字符都不会冲突，用「解析 [LIST] 的第 [INDEX] 项，取 [FIELD]」拆字段
        rows.push(JSON.stringify({
          name: m.sender_name || "",
          email: m.sender_email || "",
          content: extractUrl(m.content)
        }));
      }
      list.value = rows;
      // 刷新舞台上的列表监视器
      list._monitorUpToDate = false;
      clearError();
    },

    loadUsers: function() {
      if (!token) {
        setError("未连接，请先「桥接连接」");
        return;
      }
      clearError();
      return callEdge("get_users").then(function(d) {
        ext._usersCache = d.users || [];
      }).catch(function(e) {
        setError(e);
      });
    },

    userCount: function() {
      return ext._usersCache ? ext._usersCache.length : 0;
    },

    userLoaded: function() {
      return !!ext._usersCache;
    },

    setListToUsers: function(args) {
      var name = Scratch.Cast.toString(args.LIST).trim() || "用户列表";
      var list = findList(name);
      if (!list) {
        setError("找不到列表「" + name + "」：请先在 Scratch 里创建同名列表，并在积木下拉菜单里选中它");
        return;
      }
      if (!ext._usersCache) {
        setError("尚未加载用户：请先执行「桥接加载全部用户」");
        return;
      }
      var rows = [];
      for (var i = 0; i < ext._usersCache.length; i++) {
        var u = ext._usersCache[i];
        var email = u.email || "";
        rows.push(JSON.stringify({
          name: u.display_name || (email ? email.split("@")[0] : ""),
          email: email,
          avatar: u.avatar_url || "",
          online: presenceByEmail[email] ? "在线" : "离线",
          last_login: u.last_login || ""
        }));
      }
      list.value = rows;
      // 刷新舞台上的列表监视器
      list._monitorUpToDate = false;
      clearError();
    },

    onlineCount: function() {
      var c = 0;
      for (var k in presenceMap) c++;
      return c;
    },

    userIsOnline: function(args) {
      var email = Scratch.Cast.toString(args.EMAIL).trim();
      if (!email) return false;
      return !!presenceByEmail[email];
    },

    userAvatar: function(args) {
      var email = Scratch.Cast.toString(args.EMAIL).trim();
      if (!email) return "";
      var p = presenceByEmail[email];
      if (p && p.avatar_url) return p.avatar_url;
      var users = ext._usersCache || [];
      for (var i = 0; i < users.length; i++) {
        if (users[i].email === email && users[i].avatar_url) return users[i].avatar_url;
      }
      return getDefaultAvatar(email);
    },

    // ---- 解析列表条目：内置「[LIST] 的第 [INDEX] 项」，自动取列表对应项再解析 ----
    parseItem: function(args) {
      var list = findList(args.LIST);
      if (!list) return "";
      var idx = Scratch.Cast.toNumber(args.INDEX);
      if (!isFinite(idx)) return "";
      idx = Math.floor(idx);
      if (idx < 1 || idx > list.value.length) return "";
      return parseEntryText(list.value[idx - 1], args.FIELD);
    },

    // ---- 动态列出当前项目中的所有列表名（参照 List Tools 的 _getLists）----
    _getLists: function() {
      var lists =
        typeof Blockly === "undefined"
          ? []
          : Blockly.getMainWorkspace()
              .getVariableMap()
              .getVariablesOfType("list")
              .map(function(model) { return String(model.name); });
      return lists.length > 0 ? lists : [""];
    },

    // 触发由 onBridgeMessage 的 startHats 完成，此处无需任何操作
    whenReceived: function() {},

    lastSender: function() { return lastMsg ? (lastMsg.sender_name || "") : ""; },
    lastContent: function() { return lastMsg ? extractUrl(lastMsg.content) : ""; },
    lastTime: function() { return lastMsg ? (lastMsg.created_at || "") : ""; },
    bridgeError: function() { return lastError || ""; },
    connected: function() { return socket && socket.readyState === WebSocket.OPEN; },

    disconnect: function() {
      if (socket) { socket.close(); socket = null; }
      token = null;
      userEmail = null;
      userName = null;
      userId = null;
      presenceMap = {};
      presenceByEmail = {};
      ext._lastMsg = null;
      ext._historyCache = null;
      ext._usersCache = null;
      ext._lastCodeEmail = "";
      ext._floxSeen = {};
      ext._floxLastTs = "";
      floxAutoList = null;
      lastMsg = null;
      lastError = null;
    }
  };

  Scratch.extensions.register({
    getInfo: function() {
      return {
        id: "minichatbridge",
        name: "Minichat Bridge",
        color1: "#3b82f6",
        color2: "#1d4ed8",
        blocks: [
          // ===== 连接 =====
          { opcode: "sendFloxCode", blockType: Scratch.BlockType.COMMAND,
            text: "桥接发送 FloxChat 验证码到邮箱 [EMAIL]",
            arguments: { EMAIL: { type: Scratch.ArgumentType.STRING, defaultValue: "" } }
          },
          { opcode: "connectByCode", blockType: Scratch.BlockType.COMMAND,
            text: "桥接用验证码 [CODE] 登录邮箱 [EMAIL]（没账号会自动开通）",
            arguments: {
              CODE:  { type: Scratch.ArgumentType.STRING, defaultValue: "" },
              EMAIL: { type: Scratch.ArgumentType.STRING, defaultValue: "" }
            }
          },
          { opcode: "connect", blockType: Scratch.BlockType.COMMAND,
            text: "桥接直接连接 [EMAIL] 邮箱 [NAME] 昵称（仅限已开通账号）",
            arguments: {
              EMAIL: { type: Scratch.ArgumentType.STRING, defaultValue: "" },
              NAME:  { type: Scratch.ArgumentType.STRING, defaultValue: "" }
            }
          },
          { opcode: "connected", blockType: Scratch.BlockType.BOOLEAN,
            text: "桥接已连接？（判断连接状态）"
          },
          { opcode: "disconnect", blockType: Scratch.BlockType.COMMAND,
            text: "桥接断开连接（断开当前连接）"
          },
          "---",
          // ===== 发送 / 接收 =====
          { opcode: "send", blockType: Scratch.BlockType.COMMAND,
            text: "桥接发送 [MSG]（需先连接）",
            arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: "" } }
          },
          { opcode: "whenReceived", blockType: Scratch.BlockType.HAT,
            text: "当桥接收到消息时（需先连接）", isEdgeActivated: false
          },
          { opcode: "lastSender", blockType: Scratch.BlockType.REPORTER,
            text: "桥接最后发送者（配合接收积木用）"
          },
          { opcode: "lastContent", blockType: Scratch.BlockType.REPORTER,
            text: "桥接最后内容（配合接收积木用）"
          },
          { opcode: "lastTime", blockType: Scratch.BlockType.REPORTER,
            text: "桥接最后时间（配合接收积木用）"
          },
          "---",
          // ===== 历史 =====
          { opcode: "loadMessages", blockType: Scratch.BlockType.COMMAND,
            text: "桥接加载 [LIMIT] 条历史消息（需先连接）",
            arguments: { LIMIT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 30 } }
          },
          { opcode: "loadAllMessages", blockType: Scratch.BlockType.COMMAND,
            text: "桥接加载全部历史消息（需先连接，消息多时较慢）"
          },
          { opcode: "historyCount", blockType: Scratch.BlockType.REPORTER,
            text: "桥接历史消息数量（需先加载）"
          },
          { opcode: "historyLoaded", blockType: Scratch.BlockType.BOOLEAN,
            text: "桥接历史已加载？（判断加载状态）"
          },
          { opcode: "historyItem", blockType: Scratch.BlockType.REPORTER,
            text: "桥接历史第 [INDEX] 条 [FIELD]（需先加载）",
            arguments: {
              INDEX: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 },
              FIELD: { type: Scratch.ArgumentType.STRING, menu: "fields" }
            }
          },
          "---",
          // ===== 历史翻页（MiniChat 群里用）=====
          { opcode: "floxLoadOlder", blockType: Scratch.BlockType.COMMAND,
            text: "桥接往前翻一页更早的消息（MiniChat 群，整表重画）"
          },
          { opcode: "floxLoadNewest", blockType: Scratch.BlockType.COMMAND,
            text: "桥接跳回最新一页消息（MiniChat 群）"
          },
          { opcode: "floxPageIndex", blockType: Scratch.BlockType.REPORTER,
            text: "桥接已加载了多少条历史（MiniChat 群）"
          },
          { opcode: "floxHasMore", blockType: Scratch.BlockType.BOOLEAN,
            text: "桥接还有更早的历史可以加载？（MiniChat 群）"
          },
          "---",
          // ===== 列表 =====
          { opcode: "setListToMessages", blockType: Scratch.BlockType.COMMAND,
            text: "将 [LIST] 设为消息列表（JSON 条目，需先加载）",
            arguments: { LIST: { type: Scratch.ArgumentType.STRING, menu: "lists" } }
          },
          { opcode: "parseItem", blockType: Scratch.BlockType.REPORTER,
            text: "解析 [LIST] 的第 [INDEX] 项，取 [FIELD]（消息列表条目）",
            arguments: {
              LIST: { type: Scratch.ArgumentType.STRING, menu: "lists" },
              INDEX: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 },
              FIELD: { type: Scratch.ArgumentType.STRING, menu: "itemFields" }
            }
          },
          "---",
          // ===== 用户 =====
          { opcode: "loadUsers", blockType: Scratch.BlockType.COMMAND,
            text: "桥接加载全部用户（在线+离线，需先连接）"
          },
          { opcode: "userCount", blockType: Scratch.BlockType.REPORTER,
            text: "桥接用户总数（需先加载）"
          },
          { opcode: "userLoaded", blockType: Scratch.BlockType.BOOLEAN,
            text: "桥接用户已加载？（判断加载状态）"
          },
          { opcode: "setListToUsers", blockType: Scratch.BlockType.COMMAND,
            text: "将 [LIST] 设为用户列表（JSON 条目，需先加载）",
            arguments: { LIST: { type: Scratch.ArgumentType.STRING, menu: "lists" } }
          },
          { opcode: "onlineCount", blockType: Scratch.BlockType.REPORTER,
            text: "桥接在线用户数量（需先连接）"
          },
          { opcode: "userIsOnline", blockType: Scratch.BlockType.BOOLEAN,
            text: "桥接 [EMAIL] 是否在线？（需先连接）",
            arguments: { EMAIL: { type: Scratch.ArgumentType.STRING, defaultValue: "" } }
          },
          { opcode: "userAvatar", blockType: Scratch.BlockType.REPORTER,
            text: "桥接 [EMAIL] 的头像",
            arguments: { EMAIL: { type: Scratch.ArgumentType.STRING, defaultValue: "" } }
          },
          "---",
          // ===== FloxChat 兼容（把 MiniChat 接进 FloxChat 的聊天界面）=====
          { opcode: "floxInjectGroup", blockType: Scratch.BlockType.COMMAND,
            text: "桥接把 MiniChat 群聊写入列表 [LIST]（FloxChat 群聊格式）",
            arguments: { LIST: { type: Scratch.ArgumentType.STRING, menu: "lists" } }
          },
          { opcode: "floxRefreshMessages", blockType: Scratch.BlockType.COMMAND,
            text: "桥接刷新 MiniChat 消息到列表 [LIST]（FloxChat 消息格式，需先连接）",
            arguments: { LIST: { type: Scratch.ArgumentType.STRING, menu: "lists" } }
          },
          { opcode: "floxAutoPush", blockType: Scratch.BlockType.COMMAND,
            text: "桥接开启 MiniChat 自动推送（新消息直接写入 [LIST]，不轮询）",
            arguments: { LIST: { type: Scratch.ArgumentType.STRING, menu: "lists" } }
          },
          { opcode: "floxAutoPushOff", blockType: Scratch.BlockType.COMMAND,
            text: "桥接关闭 MiniChat 自动推送"
          },
          { opcode: "floxGroupId", blockType: Scratch.BlockType.REPORTER,
            text: "桥接 MiniChat 群聊ID（和「当前显示的群聊ID」比较用）"
          },
          { opcode: "floxResetCursor", blockType: Scratch.BlockType.COMMAND,
            text: "桥接重置 MiniChat 消息游标（清空列表后调用）"
          },
          "---",
          // ===== 排障 =====
          { opcode: "bridgeError", blockType: Scratch.BlockType.REPORTER,
            text: "桥接最后错误（无则空，配合排障用）"
          }
        ],
        menus: {
          fields: { items: [
            { text: "发送者", value: "sender" },
            { text: "内容", value: "content" },
            { text: "时间", value: "time" }
          ] },
          lists: {
            acceptReporters: true,
            items: "_getLists"
          },
          itemFields: { items: [
            { text: "名字", value: "name" },
            { text: "邮箱", value: "email" },
            { text: "内容", value: "content" },
            { text: "头像", value: "avatar" },
            { text: "在线", value: "online" },
            { text: "最后登录", value: "last_login" }
          ] }
        }
      };
    },

    connect: ext.connect,
    sendFloxCode: ext.sendFloxCode,
    connectByCode: ext.connectByCode,
    floxInjectGroup: ext.floxInjectGroup,
    floxRefreshMessages: ext.floxRefreshMessages,
    floxAutoPush: ext.floxAutoPush,
    floxAutoPushOff: ext.floxAutoPushOff,
    floxGroupId: ext.floxGroupId,
    floxResetCursor: ext.floxResetCursor,
    // ⚠️ 光在 getInfo 里声明积木是不够的：必须在这里把实现挂到 id 上，
    // 否则 Scratch 调用到的是 undefined。
    floxLoadOlder: ext.floxLoadOlder,
    floxLoadNewest: ext.floxLoadNewest,
    floxPageIndex: ext.floxPageIndex,
    floxHasMore: ext.floxHasMore,
    send: ext.send,
    loadMessages: ext.loadMessages,
    loadAllMessages: ext.loadAllMessages,
    setListToMessages: ext.setListToMessages,
    parseItem: ext.parseItem,
    _getLists: ext._getLists,
    historyCount: ext.historyCount,
    historyLoaded: ext.historyLoaded,
    historyItem: ext.historyItem,
    whenReceived: ext.whenReceived,
    lastSender: ext.lastSender,
    lastContent: ext.lastContent,
    lastTime: ext.lastTime,
    connected: ext.connected,
    bridgeError: ext.bridgeError,
    disconnect: ext.disconnect,
    loadUsers: ext.loadUsers,
    userCount: ext.userCount,
    userLoaded: ext.userLoaded,
    setListToUsers: ext.setListToUsers,
    onlineCount: ext.onlineCount,
    userIsOnline: ext.userIsOnline,
    userAvatar: ext.userAvatar
  });
})(Scratch);

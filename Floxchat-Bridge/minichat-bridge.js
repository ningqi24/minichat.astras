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
  var FLOX_GID = "MINCHAT";
  var FLOX_GROUP_NAME = "MiniChat 群聊";
  var FLOX_GROUP_AVATAR = "https://minichat.astras.cc/Floxchat-Bridge/minichat-avatar-150.svg";

  function avatarByEmail() {
    var map = {};
    var users = ext._usersCache || [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (u && u.email) map[String(u.email).toLowerCase()] = u.avatar_url || "";
    }
    return map;
  }

  // ---- 头像归一化：FloxChat 的头像规格是 150x150 正方形 ----
  // FloxChat 用「设为 N% 大小」来缩放头像，而 N% 是相对图片【自然尺寸】的百分比，
  // 所以图片本身多大就直接决定显示多大。这里在读取端把任意来源的头像
  //（包括历史上传的、尺寸各异的）统一裁成 150x150 再交给 FloxChat，
  // 存量头像完全不用重新上传。
  var FLOX_AVATAR_SIZE = 150;
  // 头像规范化「最长等多久」。超时就用原图先顶上 —— 绝不能让某张图下载慢
  // 把整条消息链路堵死（之前就是这么卡住的）。
  var FLOX_AVATAR_TIMEOUT = 2000;
  var FLOX_AVATAR_CACHE_KEY = "minichat_bridge_avatars_v1";
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
            c.getContext("2d").drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, n, n);
            done(c.toDataURL("image/jpeg", 0.85));
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

  function toFloxMessage(m, avatars) {
    var email = String(m.sender_email || "");
    return JSON.stringify({
      username: m.sender_name || (email ? email.split("@")[0] : ""),
      uid: email,
      avatar_url: floxAvatarOf(avatars, email),
      content: floxText(m.content),
      time: m.created_at || "",
      mid: m.id || ""
    });
  }

  // 把「自上次以来新增的」MiniChat 消息追加到目标列表。
  // 注意是「只追加」而不是「整表替换」：FloxChat 靠 len(列表) - len(已显示消息) 决定渲染几条，
  // 列表一旦不再变长，后面所有新消息就永远不会显示出来。
  function appendFloxMessages(listName) {
    var list = findList(listName);
    if (!list) throw new Error("找不到列表「" + listName + "」：请先在 Scratch 里创建同名列表，并在积木下拉里选中它");
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
        return added;
      });
    });
  }

  // ---- 自动推送：新消息一到就直接追加进目标列表，FloxChat 下一秒的刷新循环自会渲染 ----
  // 这样完全不需要轮询 MiniChat，也不会消耗 Edge Function 的调用额度。
  var floxAutoList = null;

  function floxAutoPushToList(msg) {
    if (!floxAutoList || !msg) return Promise.resolve();
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
      return getToken(email, args.NAME).then(function() {
        connectWS();
      }).catch(function(e) {
        setError(e);
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
      return loginWithFloxCode(email, code).then(function() {
        connectWS();
      }).catch(function(e) {
        setError(e);
      });
    },

    send: function(args) {
      if (!token || !userEmail) {
        setError("未连接，请先「桥接连接」");
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
      if (!ext._floxLastTs && token && userEmail) {
        appendFloxMessages(name).catch(function(e) { setError(e); });
      }
    },

    floxAutoPushOff: function() {
      floxAutoList = null;
      clearError();
    },

    floxResetCursor: function() {
      ext._floxSeen = {};
      ext._floxLastTs = "";
      clearError();
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

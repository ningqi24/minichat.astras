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
  var socket = null;
  var refId = 0;
  var lastMsg = null;
  var callbacks = [];

  // ---- 自动密码 ----
  function hashPwd(email) {
    var h = 0, s = "floxchat_to_minichat_2024" + email;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return "fc_" + Math.abs(h).toString(36).slice(0, 16);
  }

  // ---- 统一走 Edge Function（不带 Authorization 头，靠 secret 校验，绕开 Electron CORS bug）----
  function callEdge(action, payload) {
    var body = Object.assign({ action: action, secret: SECRET }, payload || {});
    return fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.error) throw new Error(d.error);
      return d;
    });
  }

  // ---- 登录拿 JWT ----
  function getToken(email, name) {
    return callEdge("login", {
      email: email,
      password: hashPwd(email),
      display_name: name || email.split("@")[0]
    }).then(function(d) {
      token = d.access_token;
      userEmail = d.email || email;
      userName = d.display_name || (name || email.split("@")[0]);
      return d;
    });
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
    };
    socket.onmessage = function(e) {
      try {
        var m = JSON.parse(e.data);
        if (m.payload && m.payload.data && m.payload.data.record) {
          lastMsg = m.payload.data.record;
          for (var i = 0; i < callbacks.length; i++) { callbacks[i](lastMsg); }
        }
      } catch(_) {}
    };
    socket.onclose = function() {
      if (token) { setTimeout(connectWS, 5000); }
    };
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

  // ---- 查找 Scratch 列表（跨所有角色与舞台） ----
  function findList(name) {
    var targets = Scratch.vm.runtime.targets;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (t && t.lookupVariableByNameAndType) {
        var v = t.lookupVariableByNameAndType(name, "list");
        if (v) return v;
      }
    }
    return null;
  }

  // ---- Scratch 积木 ----
  var ext = {
    _lastMsg: null,

    connect: function(args) {
      return getToken(args.EMAIL, args.NAME).then(function() {
        connectWS();
      }).catch(function(e) {
        console.error("Bridge connect failed:", e);
      });
    },

    send: function(args) {
      sendMsg(args.MSG).catch(function(e) {
        console.error("Bridge send failed:", e);
      });
    },

    loadMessages: function(args) {
      return loadHistory(args.LIMIT || 30).then(function(msgs) {
        ext._historyCache = msgs;
      }).catch(function(e) {
        console.error("Bridge load history failed:", e);
      });
    },

    loadAllMessages: function() {
      return loadAllHistory().then(function(msgs) {
        ext._historyCache = msgs;
      }).catch(function(e) {
        console.error("Bridge load all history failed:", e);
      });
    },

    historyCount: function() {
      return ext._historyCache ? ext._historyCache.length : 0;
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
      var name = args.LIST || "消息列表";
      var list = findList(name);
      if (!list) {
        console.error("Bridge: 找不到列表「" + name + "」，请先在 Scratch 里创建同名列表");
        return;
      }
      var msgs = ext._historyCache || [];
      var rows = [];
      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        var sender = m.sender_name || m.sender_email || "";
        var content = extractUrl(m.content);
        rows.push(sender ? (sender + "：" + content) : content);
      }
      list.value = rows;
    },

    whenReceived: function() {
      callbacks.push(function(msg) {
        ext._lastMsg = msg;
        Scratch.vm.runtime.startHats("minichatbridge_whenReceived");
      });
    },

    lastSender: function() { return ext._lastMsg ? (ext._lastMsg.sender_name || "") : ""; },
    lastContent: function() { return ext._lastMsg ? extractUrl(ext._lastMsg.content) : ""; },
    lastTime: function() { return ext._lastMsg ? (ext._lastMsg.created_at || "") : ""; },
    connected: function() { return socket && socket.readyState === WebSocket.OPEN; },

    disconnect: function() {
      if (socket) { socket.close(); socket = null; }
      token = null;
      userEmail = null;
      userName = null;
      callbacks = [];
      ext._lastMsg = null;
      ext._historyCache = null;
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
          { opcode: "connect", blockType: Scratch.BlockType.COMMAND,
            text: "桥接连接 [EMAIL] 邮箱 [NAME] 昵称（特权创建账户，请勿随意使用）",
            arguments: {
              EMAIL: { type: Scratch.ArgumentType.STRING, defaultValue: "" },
              NAME:  { type: Scratch.ArgumentType.STRING, defaultValue: "" }
            }
          },
          { opcode: "send", blockType: Scratch.BlockType.COMMAND,
            text: "桥接发送 [MSG]（需先连接）",
            arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: "" } }
          },
          { opcode: "loadMessages", blockType: Scratch.BlockType.COMMAND,
            text: "桥接加载 [LIMIT] 条历史消息（需先连接）",
            arguments: { LIMIT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 30 } }
          },
          { opcode: "loadAllMessages", blockType: Scratch.BlockType.COMMAND,
            text: "桥接加载全部历史消息（需先连接，消息多时较慢）"
          },
          { opcode: "setListToMessages", blockType: Scratch.BlockType.COMMAND,
            text: "将 [LIST] 设为消息列表（需先加载）",
            arguments: { LIST: { type: Scratch.ArgumentType.STRING, defaultValue: "消息列表" } },
            extensions: ["colours_data_lists"]
          },
          { opcode: "historyCount", blockType: Scratch.BlockType.REPORTER,
            text: "桥接历史消息数量（需先加载）"
          },
          { opcode: "historyItem", blockType: Scratch.BlockType.REPORTER,
            text: "桥接历史第 [INDEX] 条 [FIELD]（需先加载）",
            arguments: {
              INDEX: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 },
              FIELD: { type: Scratch.ArgumentType.STRING, menu: "fields" }
            }
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
          { opcode: "connected", blockType: Scratch.BlockType.BOOLEAN,
            text: "桥接已连接？（判断连接状态）"
          },
          { opcode: "disconnect", blockType: Scratch.BlockType.COMMAND,
            text: "桥接断开连接（断开当前连接）"
          }
        ],
        menus: {
          fields: { items: [
            { text: "发送者", value: "sender" },
            { text: "内容", value: "content" },
            { text: "时间", value: "time" }
          ] }
        }
      };
    },

    connect: ext.connect,
    send: ext.send,
    loadMessages: ext.loadMessages,
    loadAllMessages: ext.loadAllMessages,
    setListToMessages: ext.setListToMessages,
    historyCount: ext.historyCount,
    historyItem: ext.historyItem,
    whenReceived: ext.whenReceived,
    lastSender: ext.lastSender,
    lastContent: ext.lastContent,
    lastTime: ext.lastTime,
    connected: ext.connected,
    disconnect: ext.disconnect
  });
})(Scratch);

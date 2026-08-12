// FloxChat Bridge Extension for TurboWarp
// 自定义扩展 -> 粘贴此文件，非沙盒模式运行
(function(Scratch) {
  "use strict";

  var SUPABASE_URL = "https://xgugltiuszrpmbxjmqfv.supabase.co";
  var ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndWdsdGl1c3pycG1ieGptcWZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0ODE2MTUsImV4cCI6MjA5ODA1NzYxNX0.nWiJm_7Fh3-6MUdazhW7CwOAi8w2PVMsDbfhUNyUIsM";
  var EDGE_URL = "https://xgugltiuszrpmbxjmqfv.supabase.co/functions/v1/clever-task";
  var SECRET = "flox-meow-2024";

  var token = null;
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

  // ---- 通过 Edge Function 拿 JWT ----
  function getToken(email, name) {
    return fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ANON_KEY },
      body: JSON.stringify({
        email: email,
        password: hashPwd(email),
        display_name: name || email.split("@")[0],
        secret: SECRET
      })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.error) throw new Error(d.error);
      token = d.access_token;
      return d;
    });
  }

  // ---- WebSocket 实时接收 ----
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

  // ---- REST API ----
  function api(method, path, body) {
    var h = {
      "apikey": ANON_KEY,
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    };
    if (body) h["Prefer"] = "return=minimal";
    return fetch(SUPABASE_URL + path, {
      method: method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined
    }).then(function(r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      if (r.headers.get("content-length") === "0") return null;
      return r.json();
    });
  }

  function sendMsg(text) {
    return api("POST", "/rest/v1/messages", { content: text });
  }

  function loadHistory(limit) {
    return api("GET", "/rest/v1/messages?select=*&order=created_at.desc&limit=" + (limit || 30))
      .then(function(d) { return (d || []).reverse(); });
  }

  // ---- 提取文件/图片/视频/音频消息中的链接 ----
  function extractUrl(content) {
    if (!content) return "";
    // [file](url|mime|name|size) / [video](url|mime|name|size) / [audio](url|...)
    var m = content.match(/^\[(?:file|video|audio)\]\((.+?)(?:\|.*)?\)$/);
    if (m) return m[1];
    // ![image](url)
    m = content.match(/^!\[.*?\]\((.+?)\)$/);
    if (m) return m[1];
    // [label](url)
    m = content.match(/^\[.*?\]\((.+?)\)$/);
    if (m) return m[1];
    return content;
  }

  // ---- Scratch 积木 ----
  var ext = {
    _lastMsg: null,

    connect: function(args) {
      var self = this;
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
      var self = this;
      return loadHistory(args.LIMIT || 30).then(function(msgs) {
        self._historyCache = msgs;
      });
    },

    historyCount: function() {
      return this._historyCache ? this._historyCache.length : 0;
    },

    historyItem: function(args) {
      var i = (args.INDEX || 1) - 1;
      var msgs = this._historyCache || [];
      if (i < 0 || i >= msgs.length) return "";
      var m = msgs[i];
      if (args.FIELD === "sender") return m.sender_name || "";
      if (args.FIELD === "content") return extractUrl(m.content);
      if (args.FIELD === "time") return m.created_at || "";
      return "";
    },

    whenReceived: function() {
      callbacks.push(function(msg) {
        ext._lastMsg = msg;
        Scratch.vm.runtime.startHats("floxchatbridge_whenReceived");
      });
    },

    lastSender: function() { return ext._lastMsg ? (ext._lastMsg.sender_name || "") : ""; },
    lastContent: function() { return ext._lastMsg ? extractUrl(ext._lastMsg.content) : ""; },
    lastTime: function() { return ext._lastMsg ? (ext._lastMsg.created_at || "") : ""; },
    connected: function() { return socket && socket.readyState === WebSocket.OPEN; },

    disconnect: function() {
      if (socket) { socket.close(); socket = null; }
      token = null;
      callbacks = [];
      this._lastMsg = null;
      this._historyCache = null;
    }
  };

  Scratch.extensions.register({
    getInfo: function() {
      return {
        id: "floxchatbridge",
        name: "FloxChat Bridge",
        color1: "#3b82f6",
        color2: "#1d4ed8",
        blocks: [
          { opcode: "connect", blockType: Scratch.BlockType.COMMAND,
            text: "桥接连接 [EMAIL] 邮箱 [NAME] 昵称",
            arguments: {
              EMAIL: { type: Scratch.ArgumentType.STRING, defaultValue: "" },
              NAME:  { type: Scratch.ArgumentType.STRING, defaultValue: "" }
            }
          },
          { opcode: "send", blockType: Scratch.BlockType.COMMAND,
            text: "桥接发送 [MSG]",
            arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: "" } }
          },
          { opcode: "loadMessages", blockType: Scratch.BlockType.COMMAND,
            text: "桥接加载 [LIMIT] 条历史消息",
            arguments: { LIMIT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 30 } }
          },
          { opcode: "historyCount", blockType: Scratch.BlockType.REPORTER,
            text: "桥接历史消息数量"
          },
          { opcode: "historyItem", blockType: Scratch.BlockType.REPORTER,
            text: "桥接历史第 [INDEX] 条 [FIELD]",
            arguments: {
              INDEX: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 },
              FIELD: { type: Scratch.ArgumentType.STRING, menu: "fields" }
            }
          },
          { opcode: "whenReceived", blockType: Scratch.BlockType.HAT,
            text: "当桥接收到消息时", isEdgeActivated: false
          },
          { opcode: "lastSender", blockType: Scratch.BlockType.REPORTER,
            text: "桥接最后发送者"
          },
          { opcode: "lastContent", blockType: Scratch.BlockType.REPORTER,
            text: "桥接最后内容"
          },
          { opcode: "lastTime", blockType: Scratch.BlockType.REPORTER,
            text: "桥接最后时间"
          },
          { opcode: "connected", blockType: Scratch.BlockType.BOOLEAN,
            text: "桥接已连接？"
          },
          { opcode: "disconnect", blockType: Scratch.BlockType.COMMAND,
            text: "桥接断开连接"
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

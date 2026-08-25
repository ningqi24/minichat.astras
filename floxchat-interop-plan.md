# FloxChat 群聊互通适配方案（clever-task 代理方向）

> 状态：**方案文档（未实施）** · 目标版本：MiniChat.astras + minichat-bridge.js
> 说明：本方案基于对 FloxChat Alpha 0.5.8.sb3 的逆向分析（已解压 JSON）与现有桥接扩展/Edge 的现状编写。实施前需先与 FloxChat 作者确认若干协议细节（见 §6）。

---

## 1. 背景与目标

在 MiniChat（Astras 版）基础上接入 FloxChat 的验证码登录与群聊互通能力，让 MiniChat 用户能登录 FloxChat 并**收发群消息**。

| 层 | 现状 | 结论 |
|---|---|---|
| 账号互通（验证码登录 → Supabase 账号） | ✅ 已实现（clever-task login + 前端/扩展连接积木） | 无需改动 |
| 消息/群互通（读/发 FloxChat 群消息） | ❌ 未实现 | **本方案解决的内容** |

## 2. 两侧现状对比

### 2.1 MiniChat 侧（现有桥接链路）

- 扩展 minichat-bridge.js → POST clever-task（Supabase Edge Function，body 携带 secret + access_token）→ Supabase
- clever-task 现有动作：login / get_messages / send_message / get_users（均 token 校验）
- 扩展能力：连接、发送、接收（Realtime WebSocket）、历史、全部用户（在线+离线）、在线状态（presence）、头像、消息/用户列表（JSON 条目 + 解析积木）
- 通信：HTTPS + WSS，实时推送

### 2.2 FloxChat 侧（从 sb3 逆向所得）

**服务器地址**（HTTP 明文内网穿透 + Cloudflare Tunnel 备用）：
- 聊天数据主 API：http://xg-2.frp.one:32509/（消息显示/群聊列表）
- 主页/开屏：http://xg-2.frp.one:28003/（含 /send-code、/verify-code）、:33945/、:25440/
- 备用域名：https://chatear.shebiao.dpdns.org/（验证码）、https://chatgc.shebiao.dpdns.org/（群）、https://chatus.shebiao.dpdns.org/（用户）、https://chatfont.shebiao.dpdns.org/（字体）

**认证**：所有请求 body 携带共享密钥：

    {"auth": "I3NoZWJpYW8yMDEzI2NoYXQjZGF0YSNyZWcj"}

base64 解码 = #shebiao2013#chat#data#reg#（**已在 sb3 中明文暴露，属公开密钥**）

**动作（action）**：

| action | 用途 | 关键字段 |
|---|---|---|
| send-code / verify-code | 验证码发送/校验 | email / code（URL 子路径形式） |
| get_all | 获取全部数据 | — |
| create | 注册用户 | data {name, email} |
| get | 拉取某群消息 | gid（形如 FLOXGRP...） |
| list_groups | 群列表 | — |

**数据结构**：
- 群消息响应：{"messages": [{"username", "avatar_url", "content", "time", "mid"}, ...]}
- 群：gid、name、avatar_url

**通信方式**：HTTP POST JSON，**无 WebSocket，客户端轮询**。

**⚠️ 关键缺口**：sb3 0.5.8 中**未发现「发消息」动作**。可能解释：a) 该版本为只读版；b) 发送走独立接口未包含在项目内。**实施前必须向作者确认发消息协议（§6.1）**。

## 3. 目标架构（推荐：clever-task 代理）

    ┌──────────────┐    HTTPS/WSS     ┌───────────────────┐   HTTP(明文)   ┌──────────────────┐
    │ TurboWarp 扩展 │ ──────────────▶ │ clever-task (Deno) │ ────────────▶ │ FloxChat 后端      │
    │ 新增 FloxChat │  secret+token   │ 持有 FLOXCHAT_*    │  服务端密钥     │ frp/Cloudflare     │
    │ 群积木组       │ ◀────────────── │ 代理动作           │ ◀────────────  │ 轮询/发送          │
    └──────────────┘                  └───────────────────┘                └──────────────────┘

原则：
1. **密钥只在服务端**：#shebiao2013#chat#data#reg# 存 Deno 环境变量，客户端（web/扩展）永远不接触。
2. **鉴权与现有模型一致**：每个代理动作仍校验 secret + access_token。
3. **单一入口**：web 前端未来也可复用同一批代理动作。
4. **接收靠轮询**：FloxChat 后端无推送能力，实时性取决于轮询间隔（建议 2–5 秒）。

## 4. 详细设计

### 4.1 clever-task 新增动作

所有动作：POST /functions/v1/clever-task，body 含 action、secret、access_token（与现有动作一致）。

**a) flox_list_groups**
- 请求：{}
- 响应：{"groups": [{"gid", "name", "avatar_url"}], "ok": true}
- 实现：服务端 POST FloxChat 聊天 API，body {"auth": KEY, "action": "list_groups"}

**b) flox_get_messages**
- 请求：{"gid": "FLOXGRP...", "limit": 100}
- 响应：{"messages": [{"mid", "username", "avatar_url", "content", "time"}], "ok": true}
- 实现：服务端 POST，body {"auth": KEY, "action": "get", "gid": gid}；limit 在服务端截断（协议是否支持分页待确认，见 §6.2）

**c) flox_send_message**（**依赖 §6.1 作者确认的发送协议**）
- 请求：{"gid": "FLOXGRP...", "content": "..."}
- 响应：{"ok": true, "message": {...}}
- 实现：服务端按 FloxChat 发送协议转发；发送者身份用当前登录用户在 FloxChat 侧的 username（账号映射见 §6.4）

**服务端配置（环境变量）**：

    FLOXCHAT_AUTH_KEY = "#shebiao2013#chat#data#reg#"
    FLOXCHAT_API_URL  = "http://xg-2.frp.one:32509/"
    FLOXCHAT_API_URL_BACKUP = "https://chatgc.shebiao.dpdns.org/"
    FLOXCHAT_API_TIMEOUT_MS = 8000

主地址失败自动切换备用；统一 json({error: ...}) 错误包装；超时/网络错误返回可读中文错误。

### 4.2 扩展新增积木（新分组「FloxChat 群」，插在「用户」与「排障」之间）

全部复用现有模式：JSON 条目 + 现有「解析 [LIST] 的第 [INDEX] 项，取 [FIELD]」积木（字段菜单需扩展：gid、username、avatar、content、time、mid）。

| 积木 | 类型 | 说明 |
|---|---|---|
| 桥接加载 FloxChat 群列表（需先连接） | 命令 | 调 flox_list_groups，缓存 _groupsCache |
| 将 [LIST] 设为 FloxChat 群列表（JSON 条目） | 命令 | 群列表写入列表，每项 {"gid","name","avatar"} |
| 桥接加载 FloxChat 群 [GID] 的消息（需先连接） | 命令 | 调 flox_get_messages，缓存 _floxMsgCache |
| 将 [LIST] 设为 FloxChat 消息列表（JSON 条目） | 命令 | 消息写入列表，每项 {"username","avatar","content","time","mid"} |
| 桥接向 FloxChat 群 [GID] 发送 [MSG] | 命令 | 调 flox_send_message |
| 桥接 FloxChat 群 [GID] 消息数量（需先加载） | 报告 | 缓存长度 |
| 桥接 FloxChat 群 [GID] 第 [N] 条 [FIELD] | 报告 | 直接从缓存取字段（不依赖列表） |
| 桥接 FloxChat 群 [GID] 有新消息？（轮询用） | 布尔 | 比较最新 mid 与上次记录 |
| 当 FloxChat 群 [GID] 有新消息时 | 帽子 | 扩展内部定时轮询（如每 3 秒）触发 startHats |

**接收方案（二选一，建议两者都提供）**：
- 方案 1（简单）：Scratch 里「重复执行」+「桥接 FloxChat 群 [GID] 有新消息？」积木轮询。
- 方案 2（自动）：扩展内部 setInterval 轮询，发现新 mid 则 startHats（参照现有 onBridgeMessage 单次注册模式，注意清理定时器，disconnect 时停止）。

### 4.3 安全设计

- FloxChat 密钥仅存服务端 env；任何客户端请求不携带、不返回该密钥。
- 所有代理动作校验 access_token（与 get_messages 一致），未登录返回 401。
- 服务端对 FloxChat 后端做**超时 + 重试（主备切换）**，防止 frp 不稳定导致客户端卡死。
- 可选：对 flox_send_message 做内容长度限制（如 2000 字符）与简单限流。
- 认知边界：auth 密钥本身已在 sb3 中公开，**FloxChat 后端自身无强鉴权**；本方案的价值是「不把密钥再扩散到 MiniChat 客户端」并集中限流。

## 5. 分阶段实施计划

| 阶段 | 内容 | 产出 |
|---|---|---|
| M1 协议确认 | 向作者确认 §6 清单 | 协议文档定稿 |
| M2 服务端 | clever-task 新增 3 个代理动作 + env 配置 | curl/Python 实测通过 |
| M3 扩展 | 新增「FloxChat 群」积木组 + 解析字段扩展 | 模拟测试通过 |
| M4 联调部署 | 部署 clever-task、重贴扩展 | 端到端收发验证 |
| M5（可选） | 方向 B：FloxChat 群消息同步进 Supabase messages 表 | web + 扩展统一消息流 |

**测试策略（先复现再定位，符合项目习惯）**：
1. 用 Python/curl 直连 FloxChat 后端（携带 auth 密钥）验证 list_groups / get 的真实响应结构与字段；
2. 再测 clever-task 代理动作（模拟扩展请求）；
3. 最后在 TurboWarp 里联调扩展积木。

## 6. 前置依赖：需要向 FloxChat 作者确认的信息

> 这些信息拿不到，M2–M4 无法开工（尤其发消息）。

1. **发消息协议**（最关键）：发送一条群消息的端点、body 格式（action 名？字段？是否需 username/gid/content/time？）。
2. **拉取分页**：get 是否支持 limit/offset/时间游标；新消息如何增量获取（靠 mid 递增？）。
3. **get_all 返回内容**：除群列表外是否含用户/在线/头像数据（能否复用到扩展的「用户」功能）。
4. **账号映射**：FloxChat 的 username 与登录邮箱/display_name 的关系；MiniChat 用户用 FloxChat 账号发言时 username 取哪个。
5. **主备地址**：frp（xg-2.frp.one:*）与 Cloudflare（*.shebiao.dpdns.org）哪套长期稳定、哪套做主。
6. **发消息后是否可被 get 立即读到**（一致性问题，影响轮询判断）。

## 7. 风险与备选

| 风险 | 影响 | 对策 |
|---|---|---|
| frp 地址为 HTTP 明文、个人服务器不稳 | 代理超时/失败 | 服务端超时+主备切换；优先 Cloudflare 域名 |
| 发消息协议缺失（sb3 无 send 动作） | 只能「读」不能「发」 | 作者确认；等新版；或先只做读侧 |
| FloxChat 后端共享密钥已公开 | 任何拿到 sb3 的人可读数据 | 服务端持有 + 限流；不可根治（属 FloxChat 后端问题） |
| 轮询实时性（秒级延迟） | 体验略差 | 缩短间隔；后续可考虑 FloxChat 后端加推送 |
| 若选择方向 B（同步 Supabase） | 双写/去重/身份映射复杂 | 仅在确有跨端统一消息流需求时启用 |

## 8. 附：sb3 逆向分析要点（供参考）

- 8 个角色：主页(2313块)/开屏/提示/消息显示/群聊列表/用户协议/通知/通讯；联网依赖 gsaHTTPRequests + skyhigh173JSON，**无 WebSocket 扩展**。
- 消息显示角色唯一列表「刷新消息」；自定义积木「创建消息 发送用户名/头像URL/消息内容/发送时间/消息ID/是否本用户发出」。
- 验证码端点（chatear.shebiao.dpdns.org/send-code|verify-code）与 MiniChat 前端 index.html 完全一致，证实两套系统共享同一 FloxChat 账号体系。

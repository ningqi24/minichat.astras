# MiniChat 好友 / 群聊 路线图

> 目标形态：**像 QQ 那样** —— 私聊需先加好友，群聊有群主/管理员与群设置，加群有群号/申请/审批。
>
> 这份文档是设计稿与路线图，不是已完成的说明。状态会随实施更新。

---

## 0. 现状（已完成的地基）

| 项 | 状态 |
|----|------|
| `conversations` / `conversation_participants` / `messages` 三张表 | ✅ 已有 |
| `conversations.type` 合法值 | ✅ `direct` / `group` / `global` |
| 消息的会话归属（`messages.conversation_id`） | ✅ 已补齐并持续写入（439/439） |
| `messages_select` / `conversations_select` RLS | ✅ 已收紧为"只能读自己参与的会话" |
| 隔离性实测（A 读不到 B 的私密会话） | ✅ 四列全绿 |
| `create_group(p_name, p_member_ids)` RPC | ✅ 已就位（只建 `group`） |
| `conversation_participants.last_read_at` | ✅ 已加列（未读功能备用） |
| `conversations.last_message_at` | ✅ 现成，会话列表排序用它 |

也就是说：**多人会话与隔离性是现成的**，缺的是"关系"（好友）与"治理"（群管理）。

---

## 1. 目标范围（QQ 式的功能清单）

### 好友
- 搜索用户 → 发送好友请求（附验证消息）
- 收到的请求列表 → 同意 / 拒绝
- 好友列表 → 备注名、删除好友、拉黑
- 只有好友之间才能发起私聊

### 群聊
- 创建群（选好友 + 命名）
- **群号**（短号，便于搜索与分享，不是 UUID）
- 成员角色：**群主 / 管理员 / 普通成员**
- 群设置：群名、群头像、群公告、加群方式、成员上限
- 成员管理：设置/取消管理员、移出成员、禁言
- 群主转让、退群（群主退群需先转让）
- 加群方式：**允许任何人 / 需要验证 / 不允许**，另加"群号搜索 + 申请审批"与"邀请好友入群"

---

## 2. 数据模型草案

> 所有新表都要开 RLS 并配策略；写操作尽量走 `SECURITY DEFINER` RPC，
> 因为 **Edge Function 用 service_role 会绕过 RLS**，客户端直连又难以表达复杂规则。

```sql
-- 好友请求（单向）
create table friend_requests (
  id          uuid primary key default gen_random_uuid(),
  from_id     uuid not null references auth.users(id) on delete cascade,
  to_id       uuid not null references auth.users(id) on delete cascade,
  message     text,
  status      text not null default 'pending',   -- pending / accepted / rejected
  created_at  timestamptz not null default now(),
  unique (from_id, to_id)
);

-- 好友关系（双向存储，查询简单；用 least/greatest 规范化避免不对称）
create table friendships (
  user_a     uuid not null references auth.users(id) on delete cascade,
  user_b     uuid not null references auth.users(id) on delete cascade,
  remark_a   text,      -- a 给 b 的备注
  remark_b   text,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

-- 拉黑
create table blocks (
  user_id    uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id)
);

-- 群扩展设置（conversations 上加列即可，避免再开表）
alter table conversations add column if not exists group_no     text unique;
alter table conversations add column if not exists notice       text;
alter table conversations add column if not exists join_mode    text not null default 'approval'; -- open/approval/closed
alter table conversations add column if not exists max_members  int  not null default 200;
alter table conversations add column if not exists avatar_url   text;

-- 成员角色与禁言
alter table conversation_participants add column if not exists role        text not null default 'member'; -- owner/admin/member
alter table conversation_participants add column if not exists muted_until timestamptz;
alter table conversation_participants add column if not exists group_nick  text;

-- 加群申请
create table group_join_requests (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  message         text,
  status          text not null default 'pending',  -- pending/accepted/rejected
  created_at      timestamptz not null default now(),
  unique (conversation_id, user_id)
);

-- 入群邀请
create table group_invites (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  inviter_id      uuid not null references auth.users(id) on delete cascade,
  invitee_id      uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'pending',
  created_at      timestamptz not null default now(),
  unique (conversation_id, invitee_id)
);
```

### 私聊会话的唯一性

好友 A↔B 的 `direct` 会话必须**全库唯一**，否则会重复建。
建议给 `conversations` 加一个规范化键：

```sql
alter table conversations add column if not exists direct_key text unique;  -- 'least:greatest' 的 uuid 串
```

建私聊走 RPC `create_direct(p_peer uuid)`：先校验是好友、未被拉黑，再 `insert ... on conflict (direct_key) do nothing` 后取回会话 id。

---

## 3. 权限模型（谁能在哪里做什么）

| 动作 | 校验放哪 | 说明 |
|------|----------|------|
| 读会话 / 读消息 | **RLS** | 已是"是不是参与者"，够用 |
| 发消息 | RLS + Edge Function | Edge 走 service_role，**必须自己校验**参与者身份（已做）与**禁言状态**（待做） |
| 建群 / 建私聊 / 加好友 / 审批 | **SECURITY DEFINER RPC** | 规则复杂，且需要跨行校验 |
| 改群名 / 群公告 / 加群方式 | RPC（校验 owner/admin） | |
| 踢人 / 设管理员 / 禁言 | RPC（校验 owner/admin 且不能动群主） | |
| 转让群主 / 退群 | RPC | 群主退群前必须先转让 |

⚠️ **一条铁律**：Edge Function 用 service_role 会**绕过 RLS**，
凡是经过它的写操作，权限校验必须写在函数里，不能指望数据库拦。

---

## 4. 分期落地

| 期 | 内容 | 依赖 | 粗估 |
|----|------|------|------|
| **1** | 多群聊基础：会话列表、切换、建群 | Realtime-RLS 验证 | 2~3 天 |
| **1.5** | 群治理：群号、群主/管理员、群名/公告/加群方式、踢人、禁言 | 第 1 期 | 3~4 天 |
| **2** | 好友：搜索、请求、同意/拒绝、列表、备注、拉黑 | — | 3~4 天 |
| **3** | 私聊：依赖好友关系，`create_direct`、私聊列表与未读 | 第 2 期 | 2~3 天 |
| **4** | 加群：群号搜索、申请审批、邀请入群 | 第 1.5 期 | 3~4 天 |
| **5** | 完善：未读、消息分页、成员面板细化、通知中心 | 全部 | 3~5 天 |

合计约 **3~4 周**（按每天有效产出算），且**每一期结束都应该是可用的**。

---

## 5. 必须先验证的技术问题

### Realtime 的 `postgres_changes` 是否应用表 RLS

- 官方 Realtime Authorization 文档只说明通过 `realtime.messages` 的策略控制 **Broadcast / Presence**，
  **没有明确说 `postgres_changes` 会应用 public 表的 RLS**。
- 若不应用：任何登录用户都能订阅到别人新消息的**实时推送**（历史仍受 RLS 保护，但实时窃听是实打实的泄露）。
- 验证办法：两个真实账号，A 订阅 `messages` 的 INSERT（不带 filter），
  B 在一个"只有 B 参与"的会话里发消息，看 A 能否收到。
- 缓解（不能替代验证）：订阅带服务端 filter `conversation_id=eq.<当前会话>`，切换会话时重订阅。

### 通知

好友请求与加群申请都需要通知用户。现有代码没有通知中心，第 2、4 期要一并设计。

---

## 6. 明确的取舍

- **不引入框架与构建步骤**：仍是零构建的手写 JS，状态管理会更复杂，但保持贡献者门槛。
- **不做 QQ 的全部**：群等级、群活跃度、群文件、群相册、临时会话等暂不做。
- **先做可用再做好看**：每一期结束都能用，而不是憋一个大版本。

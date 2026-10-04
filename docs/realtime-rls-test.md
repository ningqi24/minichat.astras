# Realtime-RLS 验证（私聊能不能上，就靠它）

## 为什么要做

Supabase 的 `postgres_changes` 有一个前提：**表必须在 `supabase_realtime` 发布里**。
（这一条我们已经踩过了 —— 补上 `conversation_participants` / `conversations` 之后，
"别人拉我进群 / 解散群"才终于能实时收到。）

但还有一件事**没有验证过**：`postgres_changes` 推送时**会不会应用表的 RLS**。

- 官方文档里，Realtime Authorization 只讲了如何用 `realtime.messages` 的策略控制
  **Broadcast / Presence**，**没有明确说 `postgres_changes` 会应用 public 表的 RLS**。
- 这直接决定私聊安不安全：
  - **应用了** ✅ 订阅只会收到自己有权限的行 —— 私聊可以照常做。
  - **没应用** ❌ 任何登录用户都能订阅到别人会话的变更（历史消息仍受 RLS 保护，但**实时窃听**是真的）。

群聊还能忍（成员本来就该看到），**私聊不能忍**，所以必须先测。

---

## 准备

- 两个浏览器（普通窗口 + 无痕窗口），各登录一个**不同**的账号。
  下面把先登录的那个叫 **A**，另一个叫 **B**。
- 都打开 <https://minichat.astras.cc/>，按 F12 打开控制台。

> 小技巧：控制台里 `window.supabase` 就是已初始化的客户端，可以直接用。

---

## 测试 A（决定性）：A 能不能收到"跟自己无关的会话"里的新消息

### 第 1 步：造一个"只有 B 参与"的会话（SQL Editor）

把 `<B_UUID>` 换成 B 的用户 id。查 id：

```sql
select id, email from public.profiles order by last_login desc nulls last limit 5;
```

然后（注意**不要**加 begin/rollback，测试数据要留到最后一步再删）：

```sql
insert into public.conversations (id, type, name)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'direct', 'RLS探针-勿留')
on conflict (id) do nothing;

insert into public.conversation_participants (conversation_id, user_id)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '<B_UUID>'::uuid)
on conflict (conversation_id, user_id) do nothing;

select '已建好，id = cccccccc-cccc-cccc-cccc-cccccccccccc' as "结果";
```

### 第 2 步：A 的控制台里订阅（**故意不带 filter**）

```js
window.supabase.auth.getSession().then(s => console.log('我是', s.data.session?.user?.email));

window.__probe = window.supabase
  .channel('rls-probe-' + Date.now())
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      p => console.log('🔴 A 收到了消息事件！conversation_id =', p.new.conversation_id,
                       '| 内容 =', p.new.content))
  .subscribe(st => console.log('订阅状态：', st));
```

看到 `订阅状态：SUBSCRIBED` 就绪。**别关这个窗口**。

### 第 3 步：B 的控制台里往那个会话插一条

```js
(async () => {
  const s = await window.supabase.auth.getSession();
  const email = s.data.session?.user?.email;
  console.log('我是', email);
  const r = await window.supabase.from('messages').insert({
    conversation_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    content: 'RLS 探针 ' + new Date().toISOString(),
    sender_email: email,
    sender_name: 'B'
  }).select();
  console.log('插入结果：', r.error ? r.error.message : '成功');
})();
```

### 第 4 步：看 A 的控制台

| A 的表现 | 结论 |
|----------|------|
| **什么都没打印** | ✅ **应用了 RLS** —— 私聊可以放心做 |
| **打印了 🔴，且带出 cccccccc-…** | ❌ **没应用 RLS** —— 私聊不能直接上，见文末方案 |

---

## 测试 B（更便宜，可选）：A 能不能收到"别人加别人进群"的事件

因为 `conversation_participants` 现在也在发布里了，可以不碰消息表来测：

A 的控制台：

```js
window.__probe2 = window.supabase
  .channel('rls-probe2-' + Date.now())
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'conversation_participants' },
      p => console.log('🟠 A 收到了参与记录事件！', p.new))
  .subscribe(st => console.log('订阅状态：', st));
```

然后让 **B 把第三个用户（或 B 自己）加进任意一个 A 不在的群**，看 A 是否收到。

- 收到别人的参与记录 → ❌ 没应用 RLS
- 只收到跟自己相关的 → ✅ 应用了 RLS

---

## 清理

```sql
delete from public.messages where conversation_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
delete from public.conversation_participants where conversation_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
delete from public.conversations where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select '已清理' as "结果";
```

---

## 如果结果是"没应用 RLS"，可选的缓解方案

1. **只按会话订阅 + 服务端签发订阅令牌**：不让客户端自由指定 topic，
   由服务端校验成员身份后返回可用的频道名。
2. **退化为轮询**：进会话时拉一次，之后每 N 秒拉增量。成本换安全，实现最简单。
   （会话列表已经在用这招：20 秒轮询 + 切回前台立刻拉。）
3. **写入走 Edge Function，Realtime 只用于 Broadcast**：由函数校验后用
   `realtime.messages` 的 RLS 策略广播给该会话的成员（Broadcast 的鉴权是官方支持的）。
   工作量最大，但最贴合官方推荐的私有频道模型。

---

## 实测记录（跑完填这里）

- 测试 A 结果：
- 测试 B 结果：
- 结论：

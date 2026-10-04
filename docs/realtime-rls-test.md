# Realtime-RLS 验证（决定多群聊/私聊架构的关键实验）

## 为什么必须先做这个

Supabase 的官方文档里，**Realtime Authorization 只讲了如何用 `realtime.messages` 的策略
控制 Broadcast / Presence**，**没有明确说 `postgres_changes` 会不会应用 public 表的 RLS**。

这直接决定私聊安不安全：

- **如果应用 RLS** ✅ 订阅只会收到自己有权限的行，多会话架构可以照常设计。
- **如果不应用** ❌ 任何登录用户都能订阅 `messages` 表的 INSERT，
  别人私聊的新消息会**实时推给他**。历史消息仍受 RLS 保护（REST 走 RLS），
  但"实时窃听"是实打实的泄露，架构必须换（按会话订阅 + 服务端鉴权，或退化为轮询）。

---

## 第 1 步：造一个「只有 B 参与」的会话（SQL Editor）

把 `<B_UUID>` 换成 B 的用户 id（查 id：`select id, email from public.profiles order by last_login desc nulls last limit 5;`）。

```sql
-- 注意：这里【不加 begin/rollback】，测试数据要留着，最后一步再清理
insert into public.conversations (id, type, name)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'direct', 'Realtime-RLS测试-勿留')
on conflict (id) do nothing;

insert into public.conversation_participants (conversation_id, user_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '<B_UUID>'::uuid)
on conflict (conversation_id, user_id) do nothing;

select '会话已建，id = bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' as "结果";
```

---

## 第 2 步：A 的浏览器 —— 订阅 messages 的 INSERT（**故意不带 filter**）

用普通窗口登录 **A**，打开 <https://minichat.astras.cc/chat>（或直接首页），
按 F12 打开控制台，粘贴：

```js
// 先确认登录身份
window.supabase.auth.getSession().then(s => console.log('我是', s.data.session?.user?.email));

// 订阅 messages 表的全部 INSERT —— 关键是不加 filter
window.__rlsTest = window.supabase
  .channel('rls-probe-' + Date.now())
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
      p => console.log('🔴 A 收到了实时消息！conversation_id =', p.new.conversation_id,
                       '| 内容 =', p.new.content))
  .subscribe(st => console.log('订阅状态：', st));
```

看到 `订阅状态：SUBSCRIBED` 即就绪，**先别关这个窗口**。

> 注意：A **不是**那个测试会话的参与者，正常来说不该收到任何东西。

---

## 第 3 步：B 的浏览器 —— 往那个会话插一条消息

用**另一个浏览器**（或无痕窗口，确保是不同的登录态）登录 **B**，控制台粘贴：

```js
(async () => {
  const s = await window.supabase.auth.getSession();
  const email = s.data.session?.user?.email;
  console.log('我是', email);
  const r = await window.supabase.from('messages').insert({
    conversation_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    content: 'RLS 探针 ' + new Date().toISOString(),
    sender_email: email,
    sender_name: 'B'
  }).select();
  console.log('插入结果：', r.error ? r.error.message : '成功');
})();
```

---

## 第 4 步：判定

回头看 **A 的控制台**：

| A 的表现 | 结论 | 后续 |
|----------|------|------|
| **没有**打印 🔴 | ✅ **应用了 RLS** | 多会话架构照常设计，订阅可带 filter 也可不带 |
| **打印了** 🔴 且带出了测试会话的 id | ❌ **没应用 RLS** | 危险，必须改用按会话订阅 + 服务端鉴权（或轮询），**私聊不能上** |

把两边控制台的输出都贴回来。

---

## 第 5 步：清理测试数据

```sql
delete from public.messages
 where conversation_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
delete from public.conversation_participants
 where conversation_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
delete from public.conversations
 where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select '已清理' as "结果";
```

---

## 补充：如果结果是"没应用 RLS"，缓解方案有哪些

1. **只按会话订阅 + 服务端签发的订阅令牌**：不让客户端自由指定 topic，
   由服务端校验成员身份后返回可用的频道名。
2. **退化为轮询**：进入会话时拉一次，之后每 N 秒拉增量。成本换安全，实现最简单。
3. **把 Realtime 限定在 Broadcast**：写入走 Edge Function，由函数校验后用
   `realtime.messages` 的 RLS 策略广播给该会话的成员（Broadcast 的鉴权是官方支持的）。
   工作量最大，但最贴合官方推荐的私有频道模型。

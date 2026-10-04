-- ============================================================================
-- MiniChat · 第 0 期隔离实测（RLS 是否真的把不同会话隔开了）
-- ============================================================================
-- 怎么用：
--   1. 先把下面两个 <A_UUID> / <B_UUID> 换成两个真实用户 id（随便两个都行，
--      想拿 id 就跑这一句：select id, email from public.profiles order by last_login desc nulls last limit 5;）
--   2. 整段粘贴运行。它【只显示最后一个结果集】，所以结论就在最后的表格里。
--   3. 结尾 rollback，测试数据不会留在库里。
--
-- 它在做什么：
--   以 owner 身份造一个"只有 B 参与"的直聊会话和一条消息，
--   然后把自己【切换成 A 的身份】，去看 A 能不能读到 B 的东西。
--   读不到 = RLS 写对了；读到了 = 隔离失效，必须马上停下来修。
-- ============================================================================

begin;

  -- ① 造测试数据（此刻还是 owner，绕过 RLS）
  insert into public.conversations (id, type, name)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'direct', 'RLS隔离测试-勿留')
  on conflict (id) do nothing;

  insert into public.conversation_participants (conversation_id, user_id)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '<B_UUID>'::uuid)
  on conflict (conversation_id, user_id) do nothing;

  insert into public.messages (conversation_id, content, sender_email, sender_name)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '这是一条只有 B 该看到的私密消息', 'rls-test-b@example.invalid', 'B');

  -- ② 切换成 A 的身份（set local，只在本事务内有效）
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<A_UUID>","role":"authenticated"}';

  -- ③ 结论表：全部应为 ✅
  select
    case when (select count(*) from public.messages
                where conversation_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 0
         then '✅ 看不到别人的私密消息' else '❌ 能看到！隔离失效' end          as "①消息隔离（期望 ✅）",
    case when (select count(*) from public.conversations
                where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 0
         then '✅ 看不到别人的私密会话' else '❌ 能看到！隔离失效' end          as "②会话隔离（期望 ✅）",
    case when (select count(*) from public.messages
                where conversation_id = '00000000-0000-0000-0000-000000000000') > 0
         then '✅ 仍能看到全局消息（功能没被误伤）' else '❌ 全局消息也看不到了' end as "③全局可读（期望 ✅）",
    case when (select count(*) from public.conversations
                where id = '00000000-0000-0000-0000-000000000000') = 1
         then '✅ 仍能看到全局会话' else '❌ 全局会话看不到' end                 as "④全局会话（期望 ✅）",
    (select count(*) from public.messages)                                  as "参考:A能看到的消息总数",
    (select count(*) from public.conversations)                             as "参考:A能看到的会话总数";

rollback;

-- 跑完如果出现 ❌，先别继续做 UI，把结果贴回来一起看。

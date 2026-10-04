-- ============================================================================
-- MiniChat · 第 0 期验证脚本
-- ============================================================================
-- 按顺序三段跑。第二段要先把 <A_UUID> / <B_UUID> 换成真实用户 id。
-- 第一段的查询可以先拿到 id。
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 第一段：体检（跑 phase0-multichannel.sql 之前跑一次，之后跑一次对比）
-- ────────────────────────────────────────────────────────────────────────────
select
  (select count(*) from public.profiles)                                   as "总用户数",
  (select count(*) from public.profiles p
    where not exists (
      select 1 from public.conversation_participants cp
       where cp.conversation_id = '00000000-0000-0000-0000-000000000000'::uuid and cp.user_id = p.id))
                                                                           as "不是全局会话参与者(应为0)",
  (select count(*) from public.messages where conversation_id is null)      as "消息缺归属",
  (select count(*) from public.messages)                                   as "消息总数",
  (select count(*) from public.conversation_participants)                   as "参与者行数";

-- 前 5 个用户，用来填下面的 <A_UUID> / <B_UUID>
select id as "用户UUID", email, last_login
  from public.profiles
 order by last_login desc nulls last
 limit 5;

-- ────────────────────────────────────────────────────────────────────────────
-- 第二段：隔离实测（把 <A_UUID> / <B_UUID> 换成上面查到的两个 id 再跑整段）
--
--   做两件事：
--     ① 以 owner 身份造一个"只有 B 参与"的私密会话和一条私密消息
--     ② 切换成 A 的身份，检查 A 能不能看到它 —— 看不到才算 RLS 写对了
--   结尾 rollback，测试数据不会留下。
-- ────────────────────────────────────────────────────────────────────────────
begin;

  -- ① 造测试数据（此时还是 owner 身份，绕过 RLS）
  -- ⚠️ type 必须用【已存在的合法值】。conversations 表上有 conversations_type_check 约束，
  --    实测 'private' 会被拒（ERROR 23514）。这里用 'global' —— 隔离性只取决于
  --    conversation_participants 里有没有这一行，跟 type 是什么无关，所以不影响测试结论。
  --    等 diagnose-schema.sql 查出允许的完整取值后，可以换成更贴切的（例如 'group'/'direct'）。
  insert into public.conversations (id, type, name)
  select '11111111-1111-1111-1111-111111111111', type, '隔离测试-勿留'
    from public.conversations
   where id = '00000000-0000-0000-0000-000000000000'
  on conflict (id) do nothing;

  insert into public.conversation_participants (conversation_id, user_id)
  values ('11111111-1111-1111-1111-111111111111', '<B_UUID>'::uuid)
  on conflict do nothing;

  insert into public.messages (conversation_id, content, sender_email, sender_name)
  values ('11111111-1111-1111-1111-111111111111', '私密测试内容', 'b@example.invalid', 'B');

  -- ② 切换成 A 的身份
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<A_UUID>","role":"authenticated"}';

  select
    (select count(*) from public.messages
      where conversation_id = '11111111-1111-1111-1111-111111111111') as "A看到别人的私密消息(应为0)",
    (select count(*) from public.conversations
      where id = '11111111-1111-1111-1111-111111111111')             as "A看到别人的私密会话(应为0)",
    (select count(*) from public.messages
      where conversation_id = '00000000-0000-0000-0000-000000000000'::uuid)                          as "A看到全局消息(应>0)",
    (select count(*) from public.conversations
      where id = '00000000-0000-0000-0000-000000000000'::uuid)                                       as "A看到全局会话(应为1)";

rollback;

-- ────────────────────────────────────────────────────────────────────────────
-- 第三段：建群 RPC 自检（会用真实数据，看情况跑）
--   以 A 的身份调 create_group，应该返回一个新 uuid；调用后 A 应当是成员。
-- ────────────────────────────────────────────────────────────────────────────
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<A_UUID>","role":"authenticated"}';
--   select public.create_group('测试群', array[' <B_UUID>'::uuid]) as "新会话ID";
-- rollback;

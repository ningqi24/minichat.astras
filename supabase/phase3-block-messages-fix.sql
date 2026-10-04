-- ============================================================================
-- 修正：RLS 策略里的子查询【本身也受 RLS 约束】，所以跨表判断必须走 SECURITY DEFINER
-- ============================================================================
-- 上一版的 messages_insert 策略里直接 join conversation_participants 找"对方那一行"，
-- 但那张表的 RLS 是 using (user_id = auth.uid()) —— 我看不到对方的参与记录，
-- 于是"任一方拉黑"这个条件永远不成立，策略形同虚设（实测：拉黑后仍然发得出去）。
--
-- 正确做法：把跨表判断封装成 SECURITY DEFINER 函数，它内部以定义者身份读表，
-- 不受调用者的 RLS 限制（本项目里 is_group_manager / are_friends 都是这个模式）。
--
-- 可重复执行。
-- ============================================================================

-- ── ① 判断"这个私聊会话里，我和对方之间是否存在拉黑关系" ──
create or replace function public.direct_blocked_between(p_conversation_id uuid, p_uid uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.conversations c
      join public.conversation_participants other
        on other.conversation_id = c.id
       and other.user_id <> coalesce(p_uid, auth.uid())
      join public.blocks b
        on (b.user_id = coalesce(p_uid, auth.uid()) and b.blocked_id = other.user_id)
        or (b.user_id = other.user_id and b.blocked_id = coalesce(p_uid, auth.uid()))
     where c.id = p_conversation_id
       and c.type = 'direct'
  );
$fn$;

revoke all on function public.direct_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.direct_blocked_between(uuid, uuid) to authenticated;

-- ── ② 用函数重写 messages_insert 策略 ──
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    lower(sender_email) = lower(auth.jwt() ->> 'email')
    and not exists (
      select 1 from public.conversation_participants cp
       where cp.conversation_id = messages.conversation_id
         and cp.user_id = auth.uid()
         and cp.muted_until is not null
         and cp.muted_until > now()
    )
    and not public.direct_blocked_between(messages.conversation_id, auth.uid())
  );

-- ── ③ my_conversation_state 的 peer_blocked 也改用同一个函数（保持口径一致）──
create or replace function public.my_conversation_state(p_conversation_id uuid)
returns table (
  role text, muted_until timestamptz, group_nick text, join_mode text,
  notice text, group_no text, name text, conv_type text, is_member boolean, peer_blocked boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  select cp.role, cp.muted_until, cp.group_nick,
         c.join_mode, c.notice, c.group_no, c.name, c.type,
         true,
         (c.type = 'direct' and public.direct_blocked_between(c.id, auth.uid()))
    from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id
   where cp.conversation_id = p_conversation_id
     and cp.user_id = auth.uid();
$fn$;

revoke all on function public.my_conversation_state(uuid) from public, anon;
grant execute on function public.my_conversation_state(uuid) to authenticated;

-- ── ④ 自检 ──
select
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'direct_blocked_between')
       then '✅' else '❌' end as "direct_blocked_between",
  case when (select pg_get_expr(polwithcheck, polrelid) from pg_policy
              where polrelid = 'public.messages'::regclass and polname = 'messages_insert')
            like '%direct_blocked_between%'
       then '✅' else '❌' end as "策略已改用该函数",
  case when (select pg_get_expr(polwithcheck, polrelid) from pg_policy
              where polrelid = 'public.messages'::regclass and polname = 'messages_insert')
            like '%muted_until%'
       then '✅' else '❌' end as "仍拦禁言";

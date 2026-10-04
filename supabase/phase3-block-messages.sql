-- ============================================================================
-- 拉黑后不能在【已有私聊】里继续发言
-- ============================================================================
-- 问题：create_direct 只在"新建私聊"时检查拉黑，已有私聊会话点进去照样能发。
-- 修法：把检查加在 messages_insert 的 RLS 上。
--
-- ⚠️ 关键：只能对 type='direct' 生效！
--   群聊里 A 拉黑了 B，不应该导致 A 在群里不能说话；所以必须限定会话类型。
-- ============================================================================

-- ── ① messages_insert 策略加上"私聊且互相拉黑"的拦截 ──
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    -- 必须以自己的身份发言
    lower(sender_email) = lower(auth.jwt() ->> 'email')
    -- 被禁言时不能发言（不限会话类型）
    and not exists (
      select 1 from public.conversation_participants cp
       where cp.conversation_id = messages.conversation_id
         and cp.user_id = auth.uid()
         and cp.muted_until is not null
         and cp.muted_until > now()
    )
    -- 私聊：任一方拉黑对方就不能发言（群聊不受影响）
    and not exists (
      select 1
        from public.conversations c
        join public.conversation_participants other
          on other.conversation_id = c.id
         and other.user_id <> auth.uid()
        join public.blocks b
          on (b.user_id = auth.uid() and b.blocked_id = other.user_id)
          or (b.user_id = other.user_id and b.blocked_id = auth.uid())
       where c.id = messages.conversation_id
         and c.type = 'direct'
    )
  );

-- ── ② my_conversation_state 增加 peer_blocked，供前端提前给出提示 ──
drop function if exists public.my_conversation_state(uuid);

create or replace function public.my_conversation_state(p_conversation_id uuid)
returns table (
  role        text,
  muted_until timestamptz,
  group_nick  text,
  join_mode   text,
  notice      text,
  group_no    text,
  name        text,
  conv_type   text,
  is_member   boolean,
  peer_blocked boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  select cp.role, cp.muted_until, cp.group_nick,
         c.join_mode, c.notice, c.group_no, c.name, c.type,
         true,
         -- 私聊里"任一方拉黑了对方"为真；群聊恒为 false
         (c.type = 'direct' and exists (
            select 1
              from public.conversation_participants other
              join public.blocks b
                on (b.user_id = auth.uid() and b.blocked_id = other.user_id)
                or (b.user_id = other.user_id and b.blocked_id = auth.uid())
             where other.conversation_id = c.id
               and other.user_id <> auth.uid()
         ))
    from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id
   where cp.conversation_id = p_conversation_id
     and cp.user_id = auth.uid();
$fn$;

revoke all on function public.my_conversation_state(uuid) from public, anon;
grant execute on function public.my_conversation_state(uuid) to authenticated;

-- ── ③ 自检 ──
select
  case when (select pg_get_expr(polwithcheck, polrelid) from pg_policy
              where polrelid = 'public.messages'::regclass and polname = 'messages_insert')
            like '%blocks%'
       then '✅' else '❌' end as "messages_insert 已拦拉黑",
  case when (select pg_get_expr(polwithcheck, polrelid) from pg_policy
              where polrelid = 'public.messages'::regclass and polname = 'messages_insert')
            like '%muted_until%'
       then '✅' else '❌' end as "仍拦禁言",
  case when (select pg_get_expr(polwithcheck, polrelid) from pg_policy
              where polrelid = 'public.messages'::regclass and polname = 'messages_insert')
            like '%direct%'
       then '✅' else '❌' end as "只对私聊生效",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'my_conversation_state')
       then '✅' else '❌' end as "my_conversation_state";

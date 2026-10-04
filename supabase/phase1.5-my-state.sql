-- ============================================================================
-- 第 1.5/4 期：当前会话里"我的状态"（一次查回角色 / 禁言 / 加群方式 / 群公告 / 群号）
-- ============================================================================
-- 为什么单独做一个小 RPC：
--   禁言提示需要在【切换会话时】就知道自己有没有被禁言，否则用户会以为发送坏了。
--   list_conversation_members 要拉全群成员，太重；这个小函数只查我自己那一行。
-- 同时它也是第 4 期"加群"要用到的信息源（join_mode / group_no / name）。
--
-- 可重复执行。
-- ============================================================================

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
  is_member   boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  select cp.role, cp.muted_until, cp.group_nick,
         c.join_mode, c.notice, c.group_no, c.name, c.type,
         true
    from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id
   where cp.conversation_id = p_conversation_id
     and cp.user_id = auth.uid();
$fn$;

revoke all on function public.my_conversation_state(uuid) from public, anon;
grant execute on function public.my_conversation_state(uuid) to authenticated;

select
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='my_conversation_state')
       then '✅' else '❌' end as "my_conversation_state";

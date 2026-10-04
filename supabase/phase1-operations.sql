-- ============================================================================
-- 第 1 期第 4 步：会话操作 RPC（退群 / 标记已读 / 桥接开关）
-- ============================================================================
-- 为什么都要走 RPC：
--   1. conversation_participants 目前只有 select 与 insert 策略，【没有 delete 策略】，
--      客户端删不掉自己的参与记录，退群必须由服务端做；
--   2. conversations 也没有 update 策略（会话元数据不该被客户端改动），改群设置同理；
--   3. 权限判断（群主不能直接退群、谁能改设置）本来就得在服务端做。
--
-- 可重复执行。
-- ============================================================================

-- ── ① 标记已读：进入会话时把 last_read_at 推到当前时间 ──
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.conversation_participants
     set last_read_at = now()
   where conversation_id = p_conversation_id
     and user_id = v_uid;
end;
$fn$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ── ② 退出群聊 ──
--    规则（本期先这样，第 1.5 期做群主转让时再放宽）：
--      · 必须是该会话成员；
--      · 全局聊天不允许退出；
--      · 群主不能直接退出（要么先把群主转给别人，要么把群解散——两者都留到第 1.5 期）。
create or replace function public.leave_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_type text;
  v_role text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select c.type into v_type
    from public.conversations c
   where c.id = p_conversation_id;

  if v_type is null then
    raise exception 'conversation_not_found' using errcode = '22023';
  end if;
  if v_type = 'global' then
    raise exception 'cannot_leave_global' using errcode = '22023',
      hint = '全局聊天不能退出';
  end if;

  select cp.role into v_role
    from public.conversation_participants cp
   where cp.conversation_id = p_conversation_id and cp.user_id = v_uid;

  if v_role is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if v_role = 'owner' then
    raise exception 'owner_must_transfer' using errcode = '22023',
      hint = '群主不能直接退群，需要先转让群主（群主转让在第 1.5 期实现）';
  end if;

  delete from public.conversation_participants
   where conversation_id = p_conversation_id and user_id = v_uid;
end;
$fn$;

revoke all on function public.leave_conversation(uuid) from public, anon;
grant execute on function public.leave_conversation(uuid) to authenticated;

-- ── ③ 桥接开关：控制这个会话要不要同步到 FloxChat ──
--    本期先只允许群主/管理员改；私聊（direct）永远不参与桥接，直接拒绝。
create or replace function public.set_conversation_bridge_visible(
  p_conversation_id uuid,
  p_visible         boolean
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_type text;
  v_role text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select c.type into v_type from public.conversations c where c.id = p_conversation_id;
  if v_type is null then
    raise exception 'conversation_not_found' using errcode = '22023';
  end if;
  if v_type = 'direct' then
    raise exception 'direct_never_bridged' using errcode = '22023',
      hint = '私聊不参与 FloxChat 桥接';
  end if;

  select cp.role into v_role
    from public.conversation_participants cp
   where cp.conversation_id = p_conversation_id and cp.user_id = v_uid;

  if v_role is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  -- 全局聊天没有群主，允许任何成员改（它本来就只有一个）；
  -- 群聊要求 owner / admin。
  if v_type = 'group' and v_role not in ('owner', 'admin') then
    raise exception 'not_enough_privilege' using errcode = '42501',
      hint = '只有群主或管理员可以修改同步设置';
  end if;

  update public.conversations
     set bridge_visible = coalesce(p_visible, true)
   where id = p_conversation_id;
end;
$fn$;

revoke all on function public.set_conversation_bridge_visible(uuid, boolean) from public, anon;
grant execute on function public.set_conversation_bridge_visible(uuid, boolean) to authenticated;

-- ── ⑤ 未读数：一次查回当前用户所有会话的未读条数（避免前端每个会话查一次）──
--    口径：该会话里 created_at 晚于我的 last_read_at、且不是我发的消息数。
--    没有 last_read_at 的（理论上不会有，列是 NOT NULL default now()）按 0 计。
create or replace function public.list_conversation_unread()
returns table (conversation_id uuid, unread bigint)
language sql
security definer
set search_path = public
as $fn$
  select cp.conversation_id,
         count(m.id) filter (
           where m.created_at > cp.last_read_at
             and (m.sender_email is null
                  or lower(m.sender_email) <> lower(coalesce(auth.jwt() ->> 'email', '')))
         )::bigint as unread
    from public.conversation_participants cp
    left join public.messages m on m.conversation_id = cp.conversation_id
   where cp.user_id = auth.uid()
   group by cp.conversation_id;
$fn$;

revoke all on function public.list_conversation_unread() from public, anon;
grant execute on function public.list_conversation_unread() to authenticated;

-- ── 自检（补充 ④）──
select
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='mark_conversation_read')
       then '✅' else '❌' end as "mark_conversation_read",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='leave_conversation')
       then '✅' else '❌' end as "leave_conversation",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='set_conversation_bridge_visible')
       then '✅' else '❌' end as "set_conversation_bridge_visible",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='list_conversation_unread')
       then '✅' else '❌' end as "list_conversation_unread";

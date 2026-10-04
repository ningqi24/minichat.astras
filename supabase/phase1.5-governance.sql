-- ============================================================================
-- 第 1.5 期：群治理（改设置 / 管理员 / 踢人 / 禁言 / 转让）+ 无主群修复
-- ============================================================================
-- 权限模型：
--   owner  群主：一切。群名/公告/加群方式、设撤管理员、踢人、禁言、转让、解散
--   admin  管理员：改群设置、踢普通成员、禁言普通成员；【不能】设撤管理员、
--                 不能踢其他管理员、不能转让、不能解散
--   member 普通成员：只能看、只能退出
-- 另外用 RLS 在【消息插入】上拦禁言 —— 前端直连插入也绕不过去。
--
-- 同时修一个既有缺陷：删除用户（管理员删人 / 用户自己注销）时，
-- 若该用户是某群群主，原来只删参与记录，会让群【永久无主】。
-- 这里提供 depart_group_for_user()，由 Edge Function 在删用户前调用：
--   有管理员 → 交给最早加入的管理员；没有 → 交给最早加入的成员；
--   群里只剩他一个人 → 直接解散。
--
-- 可重复执行。末尾自检。
-- ============================================================================

-- ── ① 消息插入策略：把禁言拦在这里（service_role 走 Edge Function，那边另加校验）──
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
  );

-- ── ② 工具：我是不是这个群的主/管理员 ──
create or replace function public.group_role_of(p_conversation_id uuid, p_user_id uuid default null)
returns text
language sql stable security definer set search_path = public as $fn$
  select cp.role
    from public.conversation_participants cp
   where cp.conversation_id = p_conversation_id
     and cp.user_id = coalesce(p_user_id, auth.uid());
$fn$;

create or replace function public.is_group_manager(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select cp.role in ('owner', 'admin')
       from public.conversation_participants cp
      where cp.conversation_id = p_conversation_id and cp.user_id = auth.uid()),
    false);
$fn$;

revoke all on function public.group_role_of(uuid, uuid) from public, anon;
revoke all on function public.is_group_manager(uuid) from public, anon;
grant execute on function public.group_role_of(uuid, uuid) to authenticated;
grant execute on function public.is_group_manager(uuid) to authenticated;

-- ── ③ 改群资料：群名 / 群公告 / 加群方式 / 同步开关 ──
--    传 NULL 表示"这一项不动"。
create or replace function public.set_group_profile(
  p_conversation_id uuid,
  p_name            text default null,
  p_notice          text default null,
  p_join_mode       text default null,
  p_bridge_visible  boolean default null
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_type text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;

  select c.type into v_type from public.conversations c where c.id = p_conversation_id;
  if v_type is null then raise exception 'conversation_not_found' using errcode='22023'; end if;
  if v_type <> 'group' then
    raise exception 'not_a_group' using errcode='22023', hint='只有群聊可以修改群资料';
  end if;
  if not public.is_group_manager(p_conversation_id) then
    raise exception 'not_enough_privilege' using errcode='42501', hint='只有群主或管理员可以修改群设置';
  end if;
  if p_join_mode is not null and p_join_mode not in ('open', 'approval', 'closed') then
    raise exception 'bad_join_mode' using errcode='22023', hint='加群方式只能是 open / approval / closed';
  end if;

  update public.conversations
     set name           = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         notice         = case when p_notice is null then notice
                               else nullif(btrim(p_notice), '') end,
         join_mode      = coalesce(p_join_mode, join_mode),
         bridge_visible = coalesce(p_bridge_visible, bridge_visible)
   where id = p_conversation_id;
end;
$fn$;

revoke all on function public.set_group_profile(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.set_group_profile(uuid, text, text, text, boolean) to authenticated;

-- ── ④ 设 / 撤管理员（仅群主）──
create or replace function public.set_member_role(p_conversation_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_mine text;
  v_his  text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_role not in ('admin', 'member') then
    raise exception 'bad_role' using errcode='22023', hint='只能设为 admin 或 member';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot_change_self' using errcode='22023', hint='不能修改自己的角色';
  end if;

  v_mine := public.group_role_of(p_conversation_id, v_uid);
  v_his  := public.group_role_of(p_conversation_id, p_user_id);
  if v_mine is null then raise exception 'not_a_member' using errcode='42501'; end if;
  if v_mine <> 'owner' then
    raise exception 'only_owner' using errcode='42501', hint='只有群主可以设撤管理员';
  end if;
  if v_his is null then raise exception 'target_not_member' using errcode='22023'; end if;
  if v_his = 'owner' then raise exception 'target_is_owner' using errcode='22023'; end if;

  update public.conversation_participants
     set role = p_role
   where conversation_id = p_conversation_id and user_id = p_user_id;
end;
$fn$;

revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

-- ── ⑤ 踢人 ──
create or replace function public.kick_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_mine text;
  v_his  text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_user_id = v_uid then
    raise exception 'use_leave_instead' using errcode='22023', hint='退出群聊请用退出按钮';
  end if;

  v_mine := public.group_role_of(p_conversation_id, v_uid);
  v_his  := public.group_role_of(p_conversation_id, p_user_id);
  if v_mine is null then
    raise exception 'not_a_member' using errcode='42501';
  end if;
  if v_mine = 'member' then
    raise exception 'not_enough_privilege' using errcode='42501', hint='只有群主或管理员可以移出成员';
  end if;
  if v_his is null then raise exception 'target_not_member' using errcode='22023'; end if;
  if v_his = 'owner' then
    raise exception 'cannot_kick_owner' using errcode='22023', hint='不能移出群主';
  end if;
  -- 管理员不能踢管理员
  if v_mine = 'admin' and v_his = 'admin' then
    raise exception 'cannot_kick_admin' using errcode='42501', hint='管理员不能移出其他管理员';
  end if;

  delete from public.conversation_participants
   where conversation_id = p_conversation_id and user_id = p_user_id;
end;
$fn$;

revoke all on function public.kick_member(uuid, uuid) from public, anon;
grant execute on function public.kick_member(uuid, uuid) to authenticated;

-- ── ⑥ 禁言 / 解除禁言（p_minutes <= 0 表示解除）──
create or replace function public.set_member_muted(p_conversation_id uuid, p_user_id uuid, p_minutes integer)
returns timestamptz
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_mine text;
  v_his  text;
  v_until timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;

  v_mine := public.group_role_of(p_conversation_id, v_uid);
  v_his  := public.group_role_of(p_conversation_id, p_user_id);
  if v_mine is null then raise exception 'not_a_member' using errcode='42501'; end if;
  if v_mine = 'member' then
    raise exception 'not_enough_privilege' using errcode='42501', hint='只有群主或管理员可以禁言';
  end if;
  if v_his is null then raise exception 'target_not_member' using errcode='22023'; end if;
  if v_his = 'owner' then
    raise exception 'cannot_mute_owner' using errcode='22023', hint='不能禁言群主';
  end if;
  if v_mine = 'admin' and v_his = 'admin' then
    raise exception 'cannot_mute_admin' using errcode='42501', hint='管理员不能禁言其他管理员';
  end if;

  if coalesce(p_minutes, 0) <= 0 then
    v_until := null;
  else
    v_until := now() + make_interval(mins => least(p_minutes, 60 * 24 * 30));  -- 上限 30 天
  end if;

  update public.conversation_participants
     set muted_until = v_until
   where conversation_id = p_conversation_id and user_id = p_user_id;

  return v_until;
end;
$fn$;

revoke all on function public.set_member_muted(uuid, uuid, integer) from public, anon;
grant execute on function public.set_member_muted(uuid, uuid, integer) to authenticated;

-- ── ⑦ 转让群主 ──
create or replace function public.transfer_ownership(p_conversation_id uuid, p_new_owner uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_mine text;
  v_his  text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_new_owner = v_uid then return; end if;

  v_mine := public.group_role_of(p_conversation_id, v_uid);
  v_his  := public.group_role_of(p_conversation_id, p_new_owner);
  if v_mine is null then raise exception 'not_a_member' using errcode='42501'; end if;
  if v_mine <> 'owner' then
    raise exception 'only_owner' using errcode='42501', hint='只有群主可以转让群主';
  end if;
  if v_his is null then raise exception 'target_not_member' using errcode='22023'; end if;

  -- 先把新群主设为 owner，再把老的降为 member（避免出现两个 owner 的瞬间）
  update public.conversation_participants
     set role = 'owner'
   where conversation_id = p_conversation_id and user_id = p_new_owner;
  update public.conversation_participants
     set role = 'member'
   where conversation_id = p_conversation_id and user_id = v_uid;
end;
$fn$;

revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

-- ── ⑧ 用户离场处理（给 Edge Function 删用户前调用）：避免出现无主群 ──
--    返回一个可读的结果字符串，方便写日志。
create or replace function public.depart_group_for_user(p_user_id uuid)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  r        record;
  v_new    uuid;
  v_count  int := 0;
  v_diss   int := 0;
begin
  for r in
    select c.id, c.name
      from public.conversations c
      join public.conversation_participants cp
        on cp.conversation_id = c.id and cp.user_id = p_user_id and cp.role = 'owner'
     where c.type = 'group'
  loop
    v_count := v_count + 1;

    -- 优先交给最早加入的管理员，其次最早加入的成员
    select cp.user_id into v_new
      from public.conversation_participants cp
     where cp.conversation_id = r.id
       and cp.user_id <> p_user_id
     order by case cp.role when 'admin' then 0 else 1 end, cp.joined_at asc
     limit 1;

    if v_new is null then
      -- 群里只剩他一个 → 直接解散
      delete from public.messages where conversation_id = r.id;
      delete from public.conversation_participants where conversation_id = r.id;
      delete from public.conversations where id = r.id;
      v_diss := v_diss + 1;
    else
      update public.conversation_participants
         set role = 'owner'
       where conversation_id = r.id and user_id = v_new;
    end if;
  end loop;

  -- 非群主的群，普通退群即可
  delete from public.conversation_participants
   where user_id = p_user_id and conversation_id in (
     select id from public.conversations where type = 'group'
   );

  return format('处理了 %s 个自己当群主的群（移交 %s，解散 %s）', v_count, v_count - v_diss, v_diss);
end;
$fn$;

-- 这个函数只给 service_role（Edge Function）用，不给普通用户
revoke all on function public.depart_group_for_user(uuid) from public, anon, authenticated;

-- ── ⑨ 自检 ──
select
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='set_group_profile')
       then '✅' else '❌' end as "set_group_profile",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='set_member_role')
       then '✅' else '❌' end as "set_member_role",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='kick_member')
       then '✅' else '❌' end as "kick_member",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='set_member_muted')
       then '✅' else '❌' end as "set_member_muted",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='transfer_ownership')
       then '✅' else '❌' end as "transfer_ownership",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='depart_group_for_user')
       then '✅' else '❌' end as "depart_group_for_user",
  case when (select pg_get_expr(polwithcheck, polrelid) from pg_policy
              where polrelid='public.messages'::regclass and polname='messages_insert') like '%muted_until%'
       then '✅' else '❌' end as "禁言已进 RLS";

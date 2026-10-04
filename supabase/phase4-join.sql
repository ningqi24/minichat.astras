-- ============================================================================
-- 第 4 期：加群（群号搜索 / 申请审批 / 邀请）
-- ============================================================================
-- 目标形态（对齐用户要求："加群也像 QQ 那样"）：
--   · 搜群号 → 看到群名/人数/加群方式 → 按方式处理：
--       open      直接进群
--       approval  生成一条待审批申请，等群主/管理员处理
--       closed    不允许加入
--   · 邀请：群主/管理员邀请好友 → 直接进群；普通成员邀请 → 生成待审批的邀请
--   · 群主/管理员在群设置里能看到待审批列表并同意/拒绝
--
-- RLS：请求表只允许"我自己的请求"或"我是该群管理者的请求"可见；
--      写入一律走 RPC（规则多，且要校验 join_mode 与管理权限）。
--
-- 可重复执行。末尾自检。
-- ============================================================================

-- ── ① 加群申请表 ──
create table if not exists public.group_join_requests (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  inviter_id      uuid references auth.users(id) on delete set null,
  kind            text not null default 'apply',
  message         text,
  status          text not null default 'pending',
  handled_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (kind in ('apply', 'invite')),
  check (status in ('pending', 'approved', 'rejected', 'cancelled'))
);

comment on table public.group_join_requests is '加群申请/邀请；kind: apply(搜群号申请)/invite(被邀请)';

-- 同一个人对同一个群同时只能有一条待处理
create unique index if not exists gjr_pending_uniq
  on public.group_join_requests (conversation_id, user_id)
  where status = 'pending';

create index if not exists gjr_conv_idx
  on public.group_join_requests (conversation_id, status, created_at desc);

-- ── ② RLS ──
alter table public.group_join_requests enable row level security;

drop policy if exists gjr_select on public.group_join_requests;
create policy gjr_select on public.group_join_requests for select to authenticated
  using (
    user_id = auth.uid()
    or inviter_id = auth.uid()
    or public.is_group_manager(conversation_id)
  );

revoke insert, update, delete on public.group_join_requests from anon, authenticated;

-- ── ③ 按群号找群 ──
create or replace function public.find_group_by_no(p_group_no text)
returns table (
  conversation_id uuid,
  name            text,
  notice          text,
  join_mode       text,
  avatar_url      text,
  member_count    integer,
  is_member       boolean,
  my_request      text
)
language sql
stable
security definer
set search_path = public
as $fn$
  select c.id, c.name, c.notice, c.join_mode, c.avatar_url,
         (select count(*)::int from public.conversation_participants cp2
           where cp2.conversation_id = c.id),
         exists (select 1 from public.conversation_participants cp
                  where cp.conversation_id = c.id and cp.user_id = auth.uid()),
         (select r.status from public.group_join_requests r
           where r.conversation_id = c.id and r.user_id = auth.uid() and r.status = 'pending'
           limit 1)
    from public.conversations c
   where c.type = 'group'
     and c.group_no = btrim(coalesce(p_group_no, ''));
$fn$;

revoke all on function public.find_group_by_no(text) from public, anon;
grant execute on function public.find_group_by_no(text) to authenticated;

-- ── ④ 申请加群 ──
--    返回 'joined'（open 直接进）/'pending'（等审批）/'already_member'
create or replace function public.request_join_group(p_group_no text, p_message text default null)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_conv public.conversations%rowtype;
  v_cnt  int;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;

  select * into v_conv
    from public.conversations c
   where c.type = 'group' and c.group_no = btrim(coalesce(p_group_no, ''))
   limit 1;
  if v_conv.id is null then
    raise exception 'group_not_found' using errcode='22023', hint='没有找到这个群号';
  end if;

  if exists (select 1 from public.conversation_participants cp
              where cp.conversation_id = v_conv.id and cp.user_id = v_uid) then
    return 'already_member';
  end if;

  if v_conv.join_mode = 'closed' then
    raise exception 'group_closed' using errcode='42501', hint='该群不允许加入';
  end if;

  -- 人数上限
  select count(*) into v_cnt from public.conversation_participants cp where cp.conversation_id = v_conv.id;
  if v_cnt >= coalesce(v_conv.max_members, 200) then
    raise exception 'group_full' using errcode='22023', hint='该群人数已满';
  end if;

  if v_conv.join_mode = 'open' then
    insert into public.conversation_participants (conversation_id, user_id, role)
    values (v_conv.id, v_uid, 'member')
    on conflict do nothing;
    return 'joined';
  end if;

  -- approval：登记一条待审批（重复申请就刷新留言）
  insert into public.group_join_requests (conversation_id, user_id, kind, message, status)
  values (v_conv.id, v_uid, 'apply', nullif(btrim(coalesce(p_message, '')), ''), 'pending')
  on conflict (conversation_id, user_id) where status = 'pending'
    do update set message = excluded.message, updated_at = now();

  return 'pending';
end;
$fn$;

revoke all on function public.request_join_group(text, text) from public, anon;
grant execute on function public.request_join_group(text, text) to authenticated;

-- ── ⑤ 邀请入群 ──
--    群主/管理员邀请 → 直接进群（返回 'added'）
--    普通成员邀请   → 生成待审批的邀请（返回 'pending'），仍要在群的 join_mode 允许的前提下
create or replace function public.invite_to_group(p_conversation_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_type  text;
  v_mode  text;
  v_mine  text;
  v_max   int;
  v_cnt   int;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_user_id = v_uid then raise exception 'invalid_target' using errcode='22023'; end if;

  select c.type, c.join_mode, c.max_members into v_type, v_mode, v_max
    from public.conversations c where c.id = p_conversation_id;
  if v_type is null then raise exception 'conversation_not_found' using errcode='22023'; end if;
  if v_type <> 'group' then raise exception 'not_a_group' using errcode='22023'; end if;

  v_mine := public.group_role_of(p_conversation_id, v_uid);
  if v_mine is null then raise exception 'not_a_member' using errcode='42501'; end if;

  if exists (select 1 from public.conversation_participants cp
              where cp.conversation_id = p_conversation_id and cp.user_id = p_user_id) then
    return 'already_member';
  end if;

  if v_mode = 'closed' then
    raise exception 'group_closed' using errcode='42501', hint='该群不允许加入，无法邀请';
  end if;

  select count(*) into v_cnt from public.conversation_participants cp where cp.conversation_id = p_conversation_id;
  if v_cnt >= coalesce(v_max, 200) then
    raise exception 'group_full' using errcode='22023', hint='该群人数已满';
  end if;

  if v_mine in ('owner', 'admin') then
    insert into public.conversation_participants (conversation_id, user_id, role)
    values (p_conversation_id, p_user_id, 'member')
    on conflict do nothing;
    insert into public.group_join_requests (conversation_id, user_id, inviter_id, kind, status, handled_by)
    values (p_conversation_id, p_user_id, v_uid, 'invite', 'approved', v_uid)
    on conflict (conversation_id, user_id) where status = 'pending' do nothing;
    return 'added';
  end if;

  -- 普通成员邀请 → 等管理员同意
  insert into public.group_join_requests (conversation_id, user_id, inviter_id, kind, status)
  values (p_conversation_id, p_user_id, v_uid, 'invite', 'pending')
  on conflict (conversation_id, user_id) where status = 'pending'
    do update set inviter_id = excluded.inviter_id, updated_at = now();
  return 'pending';
end;
$fn$;

revoke all on function public.invite_to_group(uuid, uuid) from public, anon;
grant execute on function public.invite_to_group(uuid, uuid) to authenticated;

-- ── ⑥ 待审批列表（群主/管理员）──
create or replace function public.list_join_requests(p_conversation_id uuid)
returns table (
  id          uuid,
  user_id     uuid,
  email       text,
  display_name text,
  avatar_url  text,
  bio         text,
  kind        text,
  message     text,
  inviter_id  uuid,
  inviter_name text,
  created_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_group_manager(p_conversation_id) then
    raise exception 'not_enough_privilege' using errcode='42501', hint='只有群主或管理员可以查看加群申请';
  end if;

  return query
    select r.id, r.user_id, p.email, p.display_name, p.avatar_url, p.bio,
           r.kind, r.message, r.inviter_id, ip.display_name, r.created_at
      from public.group_join_requests r
      join public.profiles p on p.id = r.user_id
      left join public.profiles ip on ip.id = r.inviter_id
     where r.conversation_id = p_conversation_id and r.status = 'pending'
     order by r.created_at asc;
end;
$fn$;

revoke all on function public.list_join_requests(uuid) from public, anon;
grant execute on function public.list_join_requests(uuid) to authenticated;

-- ── ⑦ 处理加群申请 ──
create or replace function public.respond_join_request(p_request_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_req public.group_join_requests%rowtype;
  v_max int;
  v_cnt int;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;

  select * into v_req from public.group_join_requests where id = p_request_id;
  if v_req.id is null then raise exception 'request_not_found' using errcode='22023'; end if;
  if v_req.status <> 'pending' then raise exception 'already_handled' using errcode='22023'; end if;
  if not public.is_group_manager(v_req.conversation_id) then
    raise exception 'not_enough_privilege' using errcode='42501', hint='只有群主或管理员可以处理加群申请';
  end if;

  if coalesce(p_accept, false) then
    select coalesce(c.max_members, 200) into v_max from public.conversations c where c.id = v_req.conversation_id;
    select count(*) into v_cnt from public.conversation_participants cp where cp.conversation_id = v_req.conversation_id;
    if v_cnt >= v_max then
      raise exception 'group_full' using errcode='22023', hint='该群人数已满';
    end if;
    insert into public.conversation_participants (conversation_id, user_id, role)
    values (v_req.conversation_id, v_req.user_id, 'member')
    on conflict do nothing;
    update public.group_join_requests
       set status = 'approved', handled_by = v_uid, updated_at = now()
     where id = v_req.id;
    return 'approved';
  else
    update public.group_join_requests
       set status = 'rejected', handled_by = v_uid, updated_at = now()
     where id = v_req.id;
    return 'rejected';
  end if;
end;
$fn$;

revoke all on function public.respond_join_request(uuid, boolean) from public, anon;
grant execute on function public.respond_join_request(uuid, boolean) to authenticated;

-- ── ⑧ 我发出的、还在等审批的申请（前端给个"已申请"的显示）──
create or replace function public.list_my_join_requests()
returns table (id uuid, conversation_id uuid, name text, group_no text, kind text, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  select r.id, r.conversation_id, c.name, c.group_no, r.kind, r.status, r.created_at
    from public.group_join_requests r
    join public.conversations c on c.id = r.conversation_id
   where r.user_id = auth.uid() and r.status = 'pending'
   order by r.created_at desc;
$fn$;

revoke all on function public.list_my_join_requests() from public, anon;
grant execute on function public.list_my_join_requests() to authenticated;

-- ── ⑨ 自检 ──
select
  case when to_regclass('public.group_join_requests') is not null then '✅' else '❌' end as "group_join_requests 表",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='find_group_by_no') then '✅' else '❌' end as "find_group_by_no",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='request_join_group') then '✅' else '❌' end as "request_join_group",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='invite_to_group') then '✅' else '❌' end as "invite_to_group",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='list_join_requests') then '✅' else '❌' end as "list_join_requests",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='respond_join_request') then '✅' else '❌' end as "respond_join_request",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='list_my_join_requests') then '✅' else '❌' end as "list_my_join_requests";

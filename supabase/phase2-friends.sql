-- ============================================================================
-- 第 2 期：好友体系（服务端）
-- ============================================================================
-- 目标形态（对齐用户要求：私聊必须先加好友）：
--   · 搜人 → 发好友请求（可附验证消息）→ 对方同意/拒绝 → 成为好友
--   · 好友之间才能发起私聊（私聊本身在第 3 期做，本期先把关系建起来）
--   · 备注名、删好友、拉黑
--
-- 设计要点：
--   · friendships 用【一行表示双向】，并强制 user_a < user_b 规范化，
--     避免出现 A->B 与 B->A 两行不一致的情况。
--   · 所有写操作走 SECURITY DEFINER RPC：规则多（不能加自己、重复申请、
--     被拉黑、对方已申请则直接成为好友…），用 RLS 表达很吃力。
--   · 读走 RLS，只允许看到与自己相关的行。
--
-- 可重复执行。末尾带自检。
-- ============================================================================

-- ── ① 好友请求（单向）──
create table if not exists public.friend_requests (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references auth.users(id) on delete cascade,
  to_id      uuid not null references auth.users(id) on delete cascade,
  message    text,
  status     text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_id <> to_id),
  check (status in ('pending', 'accepted', 'rejected', 'cancelled'))
);

create unique index if not exists friend_requests_pair_uniq
  on public.friend_requests (from_id, to_id);

create index if not exists friend_requests_to_idx
  on public.friend_requests (to_id, status, created_at desc);

comment on table public.friend_requests is '好友请求，单向；status: pending/accepted/rejected/cancelled';

-- ── ② 好友关系（一行表示双向）──
create table if not exists public.friendships (
  user_a     uuid not null references auth.users(id) on delete cascade,
  user_b     uuid not null references auth.users(id) on delete cascade,
  remark_a   text,
  remark_b   text,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

comment on table public.friendships is '好友关系，双向存一行；user_a < user_b 规范化；remark_a 是 a 给 b 的备注';

-- ── ③ 拉黑 ──
create table if not exists public.blocks (
  user_id    uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  check (user_id <> blocked_id)
);

comment on table public.blocks is '拉黑名单，单向（A 拉黑 B 只表示 A 不想收到 B 的请求）';

-- ── ④ RLS：读只给自己相关的行 ──
alter table public.friend_requests enable row level security;
alter table public.friendships     enable row level security;
alter table public.blocks          enable row level security;

drop policy if exists friend_requests_select on public.friend_requests;
create policy friend_requests_select on public.friend_requests for select to authenticated
  using (from_id = auth.uid() or to_id = auth.uid());

drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists blocks_select on public.blocks;
create policy blocks_select on public.blocks for select to authenticated
  using (user_id = auth.uid());

-- 不建任何 insert/update/delete 策略：写入一律走下面的 RPC。
revoke insert, update, delete on public.friend_requests, public.friendships, public.blocks
  from anon, authenticated;

-- ── ⑤ 工具函数：规范化一对用户 ──
create or replace function public.pair_lo(p_a uuid, p_b uuid) returns uuid
language sql immutable as $fn$ select least(p_a, p_b); $fn$;

create or replace function public.pair_hi(p_a uuid, p_b uuid) returns uuid
language sql immutable as $fn$ select greatest(p_a, p_b); $fn$;

create or replace function public.are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.friendships f
     where f.user_a = least(p_a, p_b) and f.user_b = greatest(p_a, p_b)
  );
$fn$;

revoke all on function public.are_friends(uuid, uuid) from public, anon;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- ── ⑥ 发好友请求 ──
create or replace function public.send_friend_request(p_to_id uuid, p_message text default null)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_rev public.friend_requests%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_to_id is null or p_to_id = v_uid then
    raise exception 'invalid_target' using errcode = '22023', hint = '不能加自己为好友';
  end if;
  if not exists (select 1 from public.profiles where id = p_to_id) then
    raise exception 'user_not_found' using errcode = '22023';
  end if;
  if public.are_friends(v_uid, p_to_id) then
    return 'already_friends';
  end if;
  -- 对方拉黑了我，就不让发（不告诉发送方具体原因，避免暴露拉黑关系）
  if exists (select 1 from public.blocks b where b.user_id = p_to_id and b.blocked_id = v_uid) then
    raise exception 'cannot_send' using errcode = '42501', hint = '暂时无法向该用户发送好友请求';
  end if;

  -- 对方已经给我发过待处理请求 → 直接互相成为好友
  select * into v_rev from public.friend_requests
   where from_id = p_to_id and to_id = v_uid and status = 'pending'
   limit 1;
  if v_rev.id is not null then
    update public.friend_requests
       set status = 'accepted', updated_at = now()
     where id = v_rev.id;
    insert into public.friendships (user_a, user_b)
    values (least(v_uid, p_to_id), greatest(v_uid, p_to_id))
    on conflict do nothing;
    return 'accepted_each_other';
  end if;

  insert into public.friend_requests (from_id, to_id, message, status)
  values (v_uid, p_to_id, nullif(btrim(coalesce(p_message, '')), ''), 'pending')
  on conflict (from_id, to_id) do update
    set message = excluded.message, status = 'pending', updated_at = now();

  return 'sent';
end;
$fn$;

revoke all on function public.send_friend_request(uuid, text) from public, anon;
grant execute on function public.send_friend_request(uuid, text) to authenticated;

-- ── ⑦ 处理好友请求 ──
create or replace function public.respond_friend_request(p_request_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_req public.friend_requests%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into v_req from public.friend_requests where id = p_request_id;
  if v_req.id is null then raise exception 'request_not_found' using errcode = '22023'; end if;
  -- 只有收件人能处理
  if v_req.to_id <> v_uid then raise exception 'not_recipient' using errcode = '42501'; end if;
  if v_req.status <> 'pending' then raise exception 'already_handled' using errcode = '22023'; end if;

  if coalesce(p_accept, false) then
    update public.friend_requests set status = 'accepted', updated_at = now() where id = v_req.id;
    insert into public.friendships (user_a, user_b)
    values (least(v_req.from_id, v_req.to_id), greatest(v_req.from_id, v_req.to_id))
    on conflict do nothing;
    return 'accepted';
  else
    update public.friend_requests set status = 'rejected', updated_at = now() where id = v_req.id;
    return 'rejected';
  end if;
end;
$fn$;

revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

-- ── ⑧ 删好友 ──
create or replace function public.remove_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  delete from public.friendships
   where user_a = least(v_uid, p_friend_id) and user_b = greatest(v_uid, p_friend_id);
  -- 顺手把两人的历史请求标掉，方便以后重新加
  update public.friend_requests
     set status = 'cancelled', updated_at = now()
   where status = 'accepted'
     and ((from_id = v_uid and to_id = p_friend_id) or (from_id = p_friend_id and to_id = v_uid));
end;
$fn$;

revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated;

-- ── ⑨ 备注名（只改自己那一侧）──
create or replace function public.set_friend_remark(p_friend_id uuid, p_remark text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_lo  uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  v_lo := least(v_uid, p_friend_id);
  if v_lo = v_uid then
    update public.friendships set remark_a = nullif(btrim(coalesce(p_remark, '')), '')
     where user_a = v_lo and user_b = greatest(v_uid, p_friend_id);
  else
    update public.friendships set remark_b = nullif(btrim(coalesce(p_remark, '')), '')
     where user_a = v_lo and user_b = greatest(v_uid, p_friend_id);
  end if;
end;
$fn$;

revoke all on function public.set_friend_remark(uuid, text) from public, anon;
grant execute on function public.set_friend_remark(uuid, text) to authenticated;

-- ── ⑩ 拉黑 / 取消拉黑 ──
create or replace function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_user_id = v_uid then raise exception 'invalid_target' using errcode = '22023'; end if;
  insert into public.blocks (user_id, blocked_id) values (v_uid, p_user_id)
  on conflict do nothing;
end;
$fn$;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  delete from public.blocks where user_id = v_uid and blocked_id = p_user_id;
end;
$fn$;

revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ── ⑪ 一次性拉回"我的好友 + 待处理请求"（前端好友面板用）──
create or replace function public.list_my_friends()
returns table (
  friend_id     uuid,
  email         text,
  display_name  text,
  avatar_url    text,
  remark        text,
  friends_since timestamptz,
  i_blocked     boolean
)
language sql
security definer
set search_path = public
as $fn$
  select
    case when f.user_a = auth.uid() then f.user_b else f.user_a end as friend_id,
    p.email, p.display_name, p.avatar_url,
    case when f.user_a = auth.uid() then f.remark_a else f.remark_b end as remark,
    f.created_at,
    exists (select 1 from public.blocks b
             where b.user_id = auth.uid()
               and b.blocked_id = case when f.user_a = auth.uid() then f.user_b else f.user_a end) as i_blocked
  from public.friendships f
  join public.profiles p
    on p.id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
  where f.user_a = auth.uid() or f.user_b = auth.uid()
  order by f.created_at desc;
$fn$;

revoke all on function public.list_my_friends() from public, anon;
grant execute on function public.list_my_friends() to authenticated;

-- ── ⑫ 自检 ──
select
  case when to_regclass('public.friend_requests') is not null then '✅' else '❌' end as "friend_requests 表",
  case when to_regclass('public.friendships')     is not null then '✅' else '❌' end as "friendships 表",
  case when to_regclass('public.blocks')          is not null then '✅' else '❌' end as "blocks 表",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='send_friend_request')
       then '✅' else '❌' end as "send_friend_request",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='respond_friend_request')
       then '✅' else '❌' end as "respond_friend_request",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='remove_friend')
       then '✅' else '❌' end as "remove_friend",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='set_friend_remark')
       then '✅' else '❌' end as "set_friend_remark",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='block_user')
       then '✅' else '❌' end as "block_user / unblock_user",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='list_my_friends')
       then '✅' else '❌' end as "list_my_friends";

-- ============================================================================
-- 第 3 期：私聊（create_direct）
-- ============================================================================
-- 规则（对齐用户最初的要求"私聊需先加好友"）：
--   · 只有【已经是好友】才能建立私聊；
--   · 任何一方把另一方拉黑，都不允许建立（也不允许继续发——那部分靠会话可见性天然隔离）；
--   · 同一对用户【只会有一个】direct 会话：用 direct_key（小 uuid : 大 uuid）唯一约束保证，
--     并发创建时靠 unique index 兜住，冲突就回查已有会话。
--   · direct 会话恒 bridge_visible = false —— 绝不进 FloxChat 桥接列表
--     （list_bridge_conversations 里也只放 group/global，这里是双保险）。
--
-- 可重复执行。末尾自检。
-- ============================================================================

-- ── ① conversations 加 direct_key 与唯一索引 ──
alter table public.conversations add column if not exists direct_key text;
comment on column public.conversations.direct_key is '私聊会话的唯一键：least(uid):greatest(uid)，非私聊为 NULL';

create unique index if not exists conversations_direct_key_uniq
  on public.conversations (direct_key)
  where direct_key is not null;

-- ── ② 建立/取得私聊会话 ──
create or replace function public.create_direct(p_friend_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_a   uuid;
  v_b   uuid;
  v_key text;
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_friend_id is null or p_friend_id = v_uid then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_friend_id) then
    raise exception 'user_not_found' using errcode = '22023';
  end if;

  -- 必须先加好友
  if not public.are_friends(v_uid, p_friend_id) then
    raise exception 'not_friends' using errcode = '42501',
      hint = '私聊需要先加对方为好友';
  end if;

  -- 任一方拉黑都不允许
  if exists (
    select 1 from public.blocks b
     where (b.user_id = v_uid and b.blocked_id = p_friend_id)
        or (b.user_id = p_friend_id and b.blocked_id = v_uid)
  ) then
    raise exception 'blocked' using errcode = '42501',
      hint = '暂时无法发起私聊';
  end if;

  v_a := least(v_uid, p_friend_id);
  v_b := greatest(v_uid, p_friend_id);
  v_key := v_a::text || ':' || v_b::text;

  select c.id into v_id from public.conversations c where c.direct_key = v_key;
  if v_id is not null then
    -- 已有会话：确保双方都还在参与者里（比如之前退过群/被清过）
    insert into public.conversation_participants (conversation_id, user_id, role)
    values (v_id, v_uid, 'member'), (v_id, p_friend_id, 'member')
    on conflict (conversation_id, user_id) do nothing;
    return v_id;
  end if;

  insert into public.conversations (type, direct_key, created_by, bridge_visible, join_mode)
  values ('direct', v_key, v_uid, false, 'closed')
  on conflict (direct_key) do nothing
  returning id into v_id;

  -- 并发时上面可能什么都没插进去，回查一次
  if v_id is null then
    select c.id into v_id from public.conversations c where c.direct_key = v_key;
  end if;
  if v_id is null then
    raise exception 'direct_create_failed' using errcode = '22023';
  end if;

  insert into public.conversation_participants (conversation_id, user_id, role)
  values (v_id, v_uid, 'member'), (v_id, p_friend_id, 'member')
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end;
$fn$;

revoke all on function public.create_direct(uuid) from public, anon;
grant execute on function public.create_direct(uuid) to authenticated;

-- ── ③ 我的私聊列表（含对方资料与备注，供会话列表显示）──
create or replace function public.list_my_directs()
returns table (
  conversation_id uuid,
  peer_id         uuid,
  peer_email      text,
  peer_name       text,
  peer_avatar     text,
  remark          text,
  last_message_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select c.id, p.id, p.email, p.display_name, p.avatar_url,
         case when f.user_a = auth.uid() then f.remark_a else f.remark_b end,
         c.last_message_at
    from public.conversations c
    join public.conversation_participants me
      on me.conversation_id = c.id and me.user_id = auth.uid()
    join public.conversation_participants other
      on other.conversation_id = c.id and other.user_id <> auth.uid()
    join public.profiles p on p.id = other.user_id
    left join public.friendships f
      on f.user_a = least(auth.uid(), other.user_id)
     and f.user_b = greatest(auth.uid(), other.user_id)
   where c.type = 'direct'
   order by c.last_message_at desc nulls last;
$fn$;

revoke all on function public.list_my_directs() from public, anon;
grant execute on function public.list_my_directs() to authenticated;

-- ── ④ 自检 ──
select
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='conversations' and column_name='direct_key')
       then '✅' else '❌' end as "conversations.direct_key",
  case when exists (select 1 from pg_indexes
                     where schemaname='public' and indexname='conversations_direct_key_uniq')
       then '✅' else '❌' end as "direct_key 唯一索引",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='create_direct')
       then '✅' else '❌' end as "create_direct",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='list_my_directs')
       then '✅' else '❌' end as "list_my_directs";

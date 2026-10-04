-- ============================================================================
-- MiniChat · 第 1 期表结构（多群聊 + 桥接预留）
-- ============================================================================
-- 可重复执行。
--
-- ⚠️ 上一版漏了 conversations.avatar_url（桥接清单 RPC 用到它），导致
--    ERROR: 42703: column c.avatar_url does not exist。
--    教训：写 SQL 前先对着 diagnose-schema.sql 的结果核对列，别照设计稿凭印象写。
--    本版把【所有会用到的列】统一放在最前面先补，函数一律排在补列之后。
--
-- 跑完最后有一段自检，应该全部显示 ✅。
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 第 1 步：补列（全部 if not exists，可重复执行）
-- ────────────────────────────────────────────────────────────────────────────

-- 会话：桥接开关
alter table public.conversations
  add column if not exists bridge_visible boolean not null default true;

-- 会话：群号、群头像、群公告、加群方式、成员上限（后四项的逻辑在第 1.5 期做，先备列）
alter table public.conversations add column if not exists group_no    text;
alter table public.conversations add column if not exists avatar_url  text;
alter table public.conversations add column if not exists notice      text;
alter table public.conversations add column if not exists join_mode   text not null default 'approval';
alter table public.conversations add column if not exists max_members integer not null default 200;

-- 成员：群内角色、禁言到期、群昵称
alter table public.conversation_participants
  add column if not exists role text not null default 'member';
alter table public.conversation_participants add column if not exists muted_until timestamptz;
alter table public.conversation_participants add column if not exists group_nick  text;

comment on column public.conversations.bridge_visible is
  '是否同步到 FloxChat 桥接；仅对 type=group/global 生效，direct 永不暴露';
comment on column public.conversations.group_no is
  '群号，8 位数字，全局唯一；仅 type=group 使用';
comment on column public.conversations.join_mode is
  '加群方式：open(允许任何人) / approval(需要验证，默认) / closed(不允许)';
comment on column public.conversation_participants.role is
  '群内角色：owner(群主) / admin(管理员) / member(普通成员)';

create unique index if not exists conversations_group_no_uniq
  on public.conversations (group_no)
  where group_no is not null;

-- ────────────────────────────────────────────────────────────────────────────
-- 第 2 步：桥接可见的会话清单
--   ⚠️ 用 SECURITY DEFINER 是为了让桥接不必理解角色/审批/好友体系，只要一份平坦列表；
--      正因 definer 绕过 RLS，函数内部【必须】自己按 auth.uid() 过滤。
--   ⚠️ type 只放 group 与 global —— 私聊(direct) 绝不暴露给 FloxChat。
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.list_bridge_conversations()
returns table (
  id              uuid,
  name            text,
  avatar_url      text,
  group_no        text,
  last_message_at timestamptz
)
language sql
security definer
set search_path = public
as $fn$
  select c.id, c.name, c.avatar_url, c.group_no, c.last_message_at
    from public.conversations c
    join public.conversation_participants p on p.conversation_id = c.id
   where p.user_id = auth.uid()
     and c.type in ('group', 'global')
     and c.bridge_visible = true
   order by c.last_message_at desc nulls last, c.created_at desc;
$fn$;

revoke all on function public.list_bridge_conversations() from public, anon;
grant execute on function public.list_bridge_conversations() to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 第 3 步：建群 RPC（群号自动生成 + 桥接开关 + 创建者写 owner）
--   ⚠️ 签名由 (text, uuid[]) 变为 (text, uuid[], boolean)，所以 revoke/grant 也要用新签名，
--      否则旧签名上的授权会残留、新函数可能没人能执行。
-- ────────────────────────────────────────────────────────────────────────────
drop function if exists public.create_group(text, uuid[]);

create or replace function public.create_group(
  p_name           text,
  p_member_ids     uuid[],
  p_bridge_visible boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_conv uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_name, ''));
  v_no   text;
  v_n    int;
  v_try  int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 40 then
    raise exception 'invalid_group_name' using errcode = '22023';
  end if;
  if p_member_ids is null then
    raise exception 'members_required' using errcode = '22023';
  end if;

  select count(distinct x) into v_n from unnest(p_member_ids) as x where x is not null;
  if v_n > 200 then
    raise exception 'too_many_members' using errcode = '22023';
  end if;

  -- 生成不重复的 8 位群号（首位不为 0），最多试 20 次
  loop
    v_try := v_try + 1;
    v_no := (floor(random() * 90000000) + 10000000)::bigint::text;
    exit when not exists (select 1 from public.conversations where group_no = v_no);
    if v_try >= 20 then
      raise exception 'group_no_generation_failed' using errcode = '22023';
    end if;
  end loop;

  insert into public.conversations (id, type, name, created_by, group_no, bridge_visible)
  values (v_conv, 'group', v_name, v_uid, v_no, coalesce(p_bridge_visible, true));

  -- 创建者自动成为群主，其余为普通成员
  insert into public.conversation_participants (conversation_id, user_id, role)
  select v_conv, uid, case when uid = v_uid then 'owner' else 'member' end
    from (
      select v_uid as uid
      union
      select unnest(p_member_ids) as uid
    ) s
   where uid is not null
  on conflict (conversation_id, user_id) do nothing;

  return v_conv;
end;
$fn$;

revoke all on function public.create_group(text, uuid[], boolean) from public, anon;
grant execute on function public.create_group(text, uuid[], boolean) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 第 4 步：自检（应该全部 ✅）
-- ────────────────────────────────────────────────────────────────────────────
select
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='conversations' and column_name='bridge_visible')
       then '✅' else '❌' end as "conversations.bridge_visible",
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='conversations' and column_name='group_no')
       then '✅' else '❌' end as "conversations.group_no",
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='conversations' and column_name='avatar_url')
       then '✅' else '❌' end as "conversations.avatar_url",
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='conversations' and column_name='notice')
       then '✅' else '❌' end as "conversations.notice",
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='conversations' and column_name='join_mode')
       then '✅' else '❌' end as "conversations.join_mode",
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='conversations' and column_name='max_members')
       then '✅' else '❌' end as "conversations.max_members",
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='conversation_participants' and column_name='role')
       then '✅' else '❌' end as "participants.role",
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='conversation_participants' and column_name='muted_until')
       then '✅' else '❌' end as "participants.muted_until",
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='conversation_participants' and column_name='group_nick')
       then '✅' else '❌' end as "participants.group_nick",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='list_bridge_conversations')
       then '✅' else '❌' end as "list_bridge_conversations()",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='create_group'
                       and pg_get_function_arguments(p.oid) like '%boolean%')
       then '✅' else '❌' end as "create_group(text,uuid[],bool)";

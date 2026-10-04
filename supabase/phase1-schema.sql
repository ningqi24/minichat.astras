-- ============================================================================
-- MiniChat · 第 1 期表结构（多群聊 + 桥接预留）
-- ============================================================================
-- 可重复执行。执行前建议先跑 phase0-check.sql 确认第 0 期地基已就位。
-- 本文件只做三件事：
--   ① 给会话加"是否同步到 FloxChat"的开关（bridge_visible）
--   ② 给群加"群号"字段（group_no），并在建群时自动生成
--   ③ 提供一个"桥接可见的会话清单"RPC（只给群与全局，绝不给私聊）
-- ============================================================================

-- ① 桥接开关：控制这个会话要不要同步到 FloxChat。
--    默认 true（群本来就该同步）；私聊由 ③ 里的 type 过滤挡住，不靠这个字段。
alter table public.conversations
  add column if not exists bridge_visible boolean not null default true;

comment on column public.conversations.bridge_visible is
  '是否同步到 FloxChat 桥接；仅对 type=group/global 生效，direct 永不暴露';

-- ② 群号：便于搜索与分享的短号（像 QQ 群号）。先加列，第 1.5 期再做"按群号搜索/申请入群"。
alter table public.conversations
  add column if not exists group_no text;

create unique index if not exists conversations_group_no_uniq
  on public.conversations (group_no)
  where group_no is not null;

comment on column public.conversations.group_no is
  '群号，8 位数字，全局唯一；仅 type=group 使用';

-- ③ 桥接可见的会话清单
--    ⚠️ 用 SECURITY DEFINER 是为了让桥接不用理解角色/审批/好友体系，只要一份平坦列表；
--       正因为 definer 会绕过 RLS，所以函数内部【必须】自己按 auth.uid() 过滤。
--    ⚠️ type 只放 group 与 global —— 私聊(direct) 绝不暴露给 FloxChat。
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

-- ④ 建群 RPC 升级：加群号自动生成 + 桥接开关参数
--    （目前只有本项目自己在调，改签名不影响别处；参数带默认值，旧调用方式仍然可用）
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
    v_no := lpad((floor(random() * 90000000) + 10000000)::bigint::text, 8, '0');
    exit when not exists (select 1 from public.conversations where group_no = v_no);
    if v_try >= 20 then
      raise exception 'group_no_generation_failed' using errcode = '22023';
    end if;
  end loop;

  insert into public.conversations (id, type, name, created_by, group_no, bridge_visible)
  values (v_conv, 'group', v_name, v_uid, v_no, coalesce(p_bridge_visible, true));

  -- 创建者自动成为群主
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

-- role 列（第 1.5 期的群治理要用；现在补上，建群时已开始写入 owner）
alter table public.conversation_participants
  add column if not exists role text not null default 'member';

comment on column public.conversation_participants.role is
  '群内角色：owner(群主) / admin(管理员) / member(普通成员)';

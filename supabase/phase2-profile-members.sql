-- ============================================================================
-- 第 2 期补充：资料卡增强（个性标签）+ 会话成员列表
-- ============================================================================
-- 两个需求：
--   ① 点别人头像弹的资料卡内容太少 → 加个性标签，并加好友/删好友/拉黑入口；
--   ② "所有成员"按钮一直显示全局成员 → 改成显示【当前会话】的成员（像 QQ）。
--
-- 为什么成员列表必须走 RPC：
--   conversation_participants 的 RLS 是 using (user_id = auth.uid())，
--   前端直接查只能查到自己那一行，看不到同群其他人的成员记录。
--   所以用一个 SECURITY DEFINER 函数，先校验调用者确实是该会话成员，再返回全表。
--
-- 可重复执行。
-- ============================================================================

-- ── ① 个性标签 ──
alter table public.profiles add column if not exists bio text;
comment on column public.profiles.bio is '个性标签/签名，界面限制 60 字';

-- ── ② 会话成员列表 ──
create or replace function public.list_conversation_members(p_conversation_id uuid)
returns table (
  user_id      uuid,
  email        text,
  display_name text,
  avatar_url   text,
  bio          text,
  role         text,
  joined_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- 必须是这个会话的成员才给看（fail-closed）
  select exists (
    select 1 from public.conversation_participants cp
     where cp.conversation_id = p_conversation_id and cp.user_id = v_uid
  ) into v_ok;
  if not v_ok then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  return query
    select p.id, p.email, p.display_name, p.avatar_url, p.bio, cp.role, cp.joined_at
      from public.conversation_participants cp
      join public.profiles p on p.id = cp.user_id
     where cp.conversation_id = p_conversation_id
     order by
       case cp.role when 'owner' then 0 when 'admin' then 1 else 2 end,
       cp.joined_at asc;
end;
$fn$;

revoke all on function public.list_conversation_members(uuid) from public, anon;
grant execute on function public.list_conversation_members(uuid) to authenticated;

-- ── ③ 顺便：个人资料查询（资料卡用，含 bio，避免前端再拼 join）──
create or replace function public.get_user_card(p_user_id uuid)
returns table (
  id           uuid,
  email        text,
  display_name text,
  avatar_url   text,
  bio          text,
  created_at   timestamptz,
  is_friend    boolean,
  i_blocked    boolean
)
language sql
security definer
set search_path = public
as $fn$
  select p.id, p.email, p.display_name, p.avatar_url, p.bio, p.created_at,
         exists (
           select 1 from public.friendships f
            where f.user_a = least(auth.uid(), p.id) and f.user_b = greatest(auth.uid(), p.id)
         ) as is_friend,
         exists (
           select 1 from public.blocks b
            where b.user_id = auth.uid() and b.blocked_id = p.id
         ) as i_blocked
    from public.profiles p
   where p.id = p_user_id;
$fn$;

revoke all on function public.get_user_card(uuid) from public, anon;
grant execute on function public.get_user_card(uuid) to authenticated;

-- ── 自检 ──
select
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='profiles' and column_name='bio')
       then '✅' else '❌' end as "profiles.bio",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='list_conversation_members')
       then '✅' else '❌' end as "list_conversation_members",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='get_user_card')
       then '✅' else '❌' end as "get_user_card";

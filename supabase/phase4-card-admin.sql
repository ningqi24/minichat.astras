-- ============================================================================
-- 扩展 get_user_card：顺带返回"这个人在【当前会话】里的状态"，供资料卡做群管理
-- ============================================================================
-- 需求：在当前群里点普通成员的头像，资料卡上要能直接对它做管理操作
--       （设撤管理员 / 禁言 / 移出 / 转让）。
-- 为此资料卡需要知道三件事：
--   1. 目标是不是当前会话的成员（不是成员就没什么可管理的）；
--   2. 目标在当前会话的角色（不能对群主操作；管理员不能动管理员）；
--   3. 目标当前是否被禁言（决定显示"禁言"还是"解除禁言"）。
-- 另外把"我在当前会话的角色"也一起返回，省得前端再查一次。
--
-- 因为返回类型变了，必须先 drop 再建。
-- ============================================================================

drop function if exists public.get_user_card(uuid);

create or replace function public.get_user_card(
  p_user_id         uuid,
  p_conversation_id uuid default null
)
returns table (
  id                uuid,
  email             text,
  display_name      text,
  avatar_url        text,
  bio               text,
  created_at        timestamptz,
  is_friend         boolean,
  i_blocked         boolean,
  in_conversation   boolean,
  conv_role         text,
  conv_muted_until  timestamptz,
  my_conv_role      text
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    p.id, p.email, p.display_name, p.avatar_url, p.bio, p.created_at,
    exists (
      select 1 from public.friendships f
       where f.user_a = least(auth.uid(), p.id) and f.user_b = greatest(auth.uid(), p.id)
    ) as is_friend,
    exists (
      select 1 from public.blocks b
       where b.user_id = auth.uid() and b.blocked_id = p.id
    ) as i_blocked,
    (p_conversation_id is not null and exists (
      select 1 from public.conversation_participants cp
       where cp.conversation_id = p_conversation_id and cp.user_id = p.id
    )) as in_conversation,
    (select cp.role from public.conversation_participants cp
      where cp.conversation_id = p_conversation_id and cp.user_id = p.id) as conv_role,
    (select cp.muted_until from public.conversation_participants cp
      where cp.conversation_id = p_conversation_id and cp.user_id = p.id) as conv_muted_until,
    (select cp.role from public.conversation_participants cp
      where cp.conversation_id = p_conversation_id and cp.user_id = auth.uid()) as my_conv_role
  from public.profiles p
  where p.id = p_user_id;
$fn$;

revoke all on function public.get_user_card(uuid, uuid) from public, anon;
grant execute on function public.get_user_card(uuid, uuid) to authenticated;

select
  case when exists (select 1 from pg_proc gp join pg_namespace n on n.oid = gp.pronamespace
                     where n.nspname = 'public' and gp.proname = 'get_user_card')
       then '✅ get_user_card 已更新（带当前会话状态）' else '❌' end as "结果";

-- ============================================================================
-- 第 2 期补充：search_users —— 让"拉黑"真正起作用
-- ============================================================================
-- 原来前端直接查 profiles 做搜索，这样有两个问题：
--   1. 拉黑只是"对方不能发请求"，搜索里照样互相看得到，感觉没用；
--   2. 前端拿不到"别人拉黑了我"这个信息（blocks 的 RLS 只让我看自己那份），
--      所以没法做到"互不可见"。
-- 用一个 SECURITY DEFINER 函数统一过滤，一次解决：
--   排除自己 / 已是好友 / 我拉黑的人 / 拉黑了我的人。
-- 注意：被拉黑的一方【不会知道】自己被拉黑，搜不到就是搜不到，不暴露原因。
--
-- 可重复执行。
-- ============================================================================

create or replace function public.search_users(p_query text, p_limit integer default 20)
returns table (
  id           uuid,
  email        text,
  display_name text,
  avatar_url   text
)
language sql
security definer
set search_path = public
as $fn$
  select p.id, p.email, p.display_name, p.avatar_url
    from public.profiles p
   where auth.uid() is not null
     and p.id <> auth.uid()
     and p_query is not null
     and btrim(p_query) <> ''
     and (
       p.email ilike '%' || btrim(p_query) || '%'
       or coalesce(p.display_name, '') ilike '%' || btrim(p_query) || '%'
     )
     -- 已经是好友的不再出现在搜索结果里
     and not exists (
       select 1 from public.friendships f
        where f.user_a = least(auth.uid(), p.id)
          and f.user_b = greatest(auth.uid(), p.id)
     )
     -- 我拉黑的人，搜不到
     and not exists (
       select 1 from public.blocks b
        where b.user_id = auth.uid() and b.blocked_id = p.id
     )
     -- 拉黑了我的人，也搜不到（靠 SECURITY DEFINER 才看得到这一侧）
     and not exists (
       select 1 from public.blocks b
        where b.user_id = p.id and b.blocked_id = auth.uid()
     )
   order by p.email
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$fn$;

revoke all on function public.search_users(text, integer) from public, anon;
grant execute on function public.search_users(text, integer) to authenticated;

-- 同时给"拉黑"补一条更有意义的语义：拉黑时如果还是好友，保留好友关系（QQ 的做法），
-- 但私聊会在第 3 期被禁止。这里只补一个查询函数，方便前端显示"我拉黑了谁"。
create or replace function public.list_my_blocks()
returns table (blocked_id uuid, email text, display_name text, avatar_url text, created_at timestamptz)
language sql
security definer
set search_path = public
as $fn$
  select b.blocked_id, p.email, p.display_name, p.avatar_url, b.created_at
    from public.blocks b
    join public.profiles p on p.id = b.blocked_id
   where b.user_id = auth.uid()
   order by b.created_at desc;
$fn$;

revoke all on function public.list_my_blocks() from public, anon;
grant execute on function public.list_my_blocks() to authenticated;

-- 自检
select
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='search_users')
       then '✅' else '❌' end as "search_users",
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='list_my_blocks')
       then '✅' else '❌' end as "list_my_blocks";

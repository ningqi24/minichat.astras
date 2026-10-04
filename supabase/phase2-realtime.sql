-- ============================================================================
-- 第 2 期：把好友相关表加入 Realtime 发布
-- ============================================================================
-- 与 phase1-realtime.sql 同理：postgres_changes 只推送在 supabase_realtime 发布里的表。
-- 好友请求要能实时到达（对方发来请求立刻看到），必须把 friend_requests 加进发布。
-- friendships / blocks 也一起加，便于前端在别处解除好友、被拉黑时即时反映。
--
-- 可重复执行。末尾 3 项自检。
-- ============================================================================

do $do$
declare
  t text;
  tbls text[] := array['friend_requests', 'friendships', 'blocks'];
begin
  foreach t in array tbls loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice '已加入发布: %', t;
    else
      raise notice '已在发布中: %', t;
    end if;
  end loop;
end
$do$;

select
  case when exists (select 1 from pg_publication_tables
                     where pubname='supabase_realtime' and tablename='friend_requests')
       then '✅' else '❌' end as "friend_requests",
  case when exists (select 1 from pg_publication_tables
                     where pubname='supabase_realtime' and tablename='friendships')
       then '✅' else '❌' end as "friendships",
  case when exists (select 1 from pg_publication_tables
                     where pubname='supabase_realtime' and tablename='blocks')
       then '✅' else '❌' end as "blocks";

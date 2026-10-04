-- ============================================================================
-- 第 1 期：把会话相关的表加入 Realtime 发布
-- ============================================================================
-- 为什么：Supabase 的 postgres_changes 只会推送【在 supabase_realtime 发布里的表】的变更。
--   messages 早就在发布里（所以聊天消息是实时的），
--   但 conversation_participants / conversations 当初没加 ——
--   于是"被别人拉进群 / 群被解散 / 群改名"这些事件前端【根本收不到】，
--   表现就是必须刷新页面才看得到。这很可能就是实时不生效的真正原因。
--
-- 可重复执行。跑完最后有一段自检，应该全部 ✅。
-- ============================================================================

-- 幂等地把表加入发布（已在发布里时跳过，不会报错）
do $do$
declare
  t text;
  tbls text[] := array['conversation_participants', 'conversations'];
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

-- 自检：这三张表都应在发布里
select
  case when exists (select 1 from pg_publication_tables
                     where pubname='supabase_realtime' and tablename='messages')
       then '✅' else '❌' end as "messages",
  case when exists (select 1 from pg_publication_tables
                     where pubname='supabase_realtime' and tablename='conversation_participants')
       then '✅' else '❌' end as "conversation_participants",
  case when exists (select 1 from pg_publication_tables
                     where pubname='supabase_realtime' and tablename='conversations')
       then '✅' else '❌' end as "conversations";

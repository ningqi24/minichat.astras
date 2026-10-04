-- ============================================================================
-- MiniChat · 第 0 期进度的"一条查询全出"体检
-- ============================================================================
-- 为什么要做成一条：Supabase SQL Editor 一次只显示最后一个结果集，
-- 分成多条查询的话只能看到最后一条的结果（之前就是这么漏掉 RLS 那段的）。
-- 这里全部 union all 成单一结果集，一次粘贴、一次看全。
--
-- 跑完把这 9 行贴回来即可。
-- ============================================================================

select '① messages_select 是否已收紧' as "检查项",
       case when exists (
         select 1 from pg_policies
          where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_select'
            and coalesce(qual, with_check) not in ('true', '(true)')
            and coalesce(qual, with_check) like '%conversation_participants%'
       ) then '✅ 已收紧（不再是 using true）' else '❌ 还是旧的 using true' end as "结果"
union all
select '② conversations_select 是否已收紧',
       case when exists (
         select 1 from pg_policies
          where schemaname = 'public' and tablename = 'conversations' and policyname = 'conversations_select'
            and coalesce(qual, with_check) not in ('true', '(true)')
            and coalesce(qual, with_check) like '%conversation_participants%'
       ) then '✅ 已收紧' else '❌ 还是旧的 using true' end
union all
select '③ create_group 函数是否存在',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'create_group'
       ) then '✅ 存在' else '❌ 不存在' end
union all
select '④ 消息缺归属的条数（应为 0）',
       (select count(*)::text from public.messages where conversation_id is null)
union all
select '⑤ 不是全局会话参与者的用户数（应为 0）',
       (select count(*)::text from public.profiles p
         where not exists (
           select 1 from public.conversation_participants cp
            where cp.conversation_id = '00000000-0000-0000-0000-000000000000'::uuid and cp.user_id = p.id))
union all
select '⑥ conversations 的 type 取值分布',
       coalesce((select string_agg(t || ' ×' || c, ', ')
                   from (select type as t, count(*)::text as c
                           from public.conversations group by type) s), '（空表）')
union all
select '⑦ conversation_participants 行数',
       (select count(*)::text from public.conversation_participants)
union all
select '⑧ messages 总行数 / 有归属的行数',
       (select count(*)::text from public.messages) || ' / '
       || (select count(*)::text from public.messages where conversation_id is not null)
union all
select '⑨ 参与者唯一约束（主键）是否在',
       case when exists (
         select 1 from pg_constraint con
           join pg_class rel on rel.oid = con.conrelid
           join pg_namespace nsp on nsp.oid = rel.relnamespace
          where nsp.nspname = 'public' and rel.relname = 'conversation_participants'
            and con.contype = 'p'
       ) then '✅ 有主键 (conversation_id, user_id)' else '❌ 没有' end
order by 1;

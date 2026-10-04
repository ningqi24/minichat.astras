-- ============================================================================
-- 修复 create_direct 的 ON CONFLICT 报错
-- ============================================================================
-- 报错：there is no unique or exclusion constraint matching the ON CONFLICT specification
-- 原因：conversations_direct_key_uniq 是【部分唯一索引】（带 where direct_key is not null），
--       而 ON CONFLICT (direct_key) 只在【完整唯一索引/约束】上才成立；
--       要用部分索引必须把谓词也写上：ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL。
-- 之所以当初写成部分索引，是担心"很多行的 direct_key 为 NULL 会互相冲突"——
-- 这个担心是多余的：PostgreSQL 里 NULL 在唯一索引中【彼此不相等】，多行 NULL 完全没问题。
-- 所以直接换成普通唯一索引，既满足 ON CONFLICT，也不会影响群聊/全局会话（它们 direct_key 为 NULL）。
-- ============================================================================

drop index if exists public.conversations_direct_key_uniq;

create unique index if not exists conversations_direct_key_uniq
  on public.conversations (direct_key);

comment on index public.conversations_direct_key_uniq is '私聊会话唯一键；direct_key 为 NULL 的行（群聊/全局）在唯一索引中互不冲突';

-- 自检：确认索引是【非部分】索引
select
  case when exists (
    select 1 from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where c.relname = 'conversations_direct_key_uniq'
       and i.indpred is null
  ) then '✅ 是非部分唯一索引（ON CONFLICT 可用）' else '❌ 仍是部分索引' end as "结果";

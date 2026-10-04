-- ============================================================================
-- MiniChat · 表结构诊断（只读，不改任何东西）
-- 目的：查清 conversations.type 允许哪些值、以及三张表的完整列与索引。
--       之前写脚本时是照代码推断的，结果验证脚本撞上了 conversations_type_check。
-- 用法：SQL Editor 整段粘贴运行，把结果全部贴回来。
-- ============================================================================

-- ① conversations 上的所有约束（重点是 conversations_type_check 的定义）
select
  con.conname                          as "约束名",
  con.contype                          as "类型(c=check,u=唯一,p=主键,f=外键)",
  pg_get_constraintdef(con.oid)        as "定义"
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname in ('conversations', 'conversation_participants', 'messages')
order by rel.relname, con.conname;

-- ② 三张表的列
select
  table_name    as "表",
  column_name   as "列",
  data_type     as "类型",
  is_nullable   as "可空",
  column_default as "默认值"
from information_schema.columns
where table_schema = 'public'
  and table_name in ('conversations', 'conversation_participants', 'messages')
order by table_name, ordinal_position;

-- ③ 现有 conversations 里到底有哪些 type 值（看实际用法）
select type as "已存在的type", count(*) as "条数"
  from public.conversations
 group by type
 order by count(*) desc;

-- ④ 索引
select
  tablename as "表",
  indexname as "索引",
  indexdef  as "定义"
from pg_indexes
where schemaname = 'public'
  and tablename in ('conversations', 'conversation_participants', 'messages')
order by tablename, indexname;

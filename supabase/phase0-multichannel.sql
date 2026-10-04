-- ============================================================================
-- MiniChat · 第 0 期：多会话地基
-- ============================================================================
-- 目的：为「私聊 + 多群聊」打地基。做完之后【现有功能完全不变】（仍是单一大厅），
--       但数据层的隔离性已经能承重。
--
-- 怎么用：Supabase 后台 → SQL Editor → 整段粘贴 → Run。可重复执行。
--
-- ⚠️ 顺序很重要，不要拆开跑：
--     ① 先把所有用户补进全局会话，② 再补齐消息归属，… ⑥ 最后才收紧 RLS。
--     如果先收紧 RLS 再补参与者，已登录用户会瞬间什么都看不到。
--
-- ⚠️ 重要前提：这个脚本必须在【前端与 Edge Function 已经会写 conversation_id】之后跑。
--     历史情况是 messages.conversation_id 一直是 NULL（前端插入时压根没写这个字段，
--     Edge Function 的 send_message 也没写），所有人都在一个「全局聊天」里。
--     如果只跑 SQL 不收代码，新消息还会继续是 NULL，收紧 RLS 之后就谁也看不到了。
--     配套代码改动：js/app.js 的消息插入 + Edge Function 的 send_message / get_messages。
--
-- ⚠️ 收紧 RLS 前请先跑一遍同目录的 phase0-verify.sql 的"体检"部分，
--     确认没有「有人不是全局会话参与者」，并记下「消息 conversation_id 为空」的数量
--     （第 ② 步会补齐它，跑完应该变成 0）。
-- ============================================================================

-- ① 让所有已存在的用户都成为「全局聊天」的参与者
--    （必须在收紧 RLS 之前；否则老用户收紧后读不到任何消息）
insert into public.conversation_participants (conversation_id, user_id)
select '00000000-0000-0000-0000-000000000000'::uuid, p.id
  from public.profiles p
 where not exists (
   select 1 from public.conversation_participants cp
    where cp.conversation_id = '00000000-0000-0000-0000-000000000000'::uuid
      and cp.user_id = p.id
 );

-- ② 补齐历史消息的会话归属
update public.messages
   set conversation_id = '00000000-0000-0000-0000-000000000000'::uuid
 where conversation_id is null;

-- ③ 参与者去重 + 加唯一约束（让后续插入可以幂等）
delete from public.conversation_participants a
 using public.conversation_participants b
 where a.ctid < b.ctid
   and a.conversation_id = b.conversation_id
   and a.user_id = b.user_id;

create unique index if not exists cp_conv_user_uniq
  on public.conversation_participants (conversation_id, user_id);

-- ④ 索引：RLS 的 exists 子查询每次都要查 participants，没有索引会全表扫
create index if not exists cp_user_conv_idx
  on public.conversation_participants (user_id, conversation_id);

create index if not exists msg_conv_time_idx
  on public.messages (conversation_id, created_at desc);

-- ⑤ 补列（为后面几期准备；现在加不影响现有功能，都是可空的）
alter table public.conversation_participants add column if not exists last_read_at timestamptz;
alter table public.conversations add column if not exists created_by uuid;
alter table public.conversations add column if not exists created_at timestamptz default now();
alter table public.conversations alter column created_at set default now();

-- ⑥ 收紧 RLS（本期的核心）
--    原来 messages_select / conversations_select 都是 using (true)，
--    即任何登录用户能读所有消息、列出所有会话。不收紧就上私聊，私聊等于公开广播。
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (exists (
    select 1 from public.conversation_participants cp
     where cp.conversation_id = messages.conversation_id
       and cp.user_id = auth.uid()
  ));

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (exists (
    select 1 from public.conversation_participants cp
     where cp.conversation_id = conversations.id
       and cp.user_id = auth.uid()
  ));

-- ⑦ 建群 RPC
--    现有的 cp_insert 策略是 with check (user_id = auth.uid())，即只能把自己加进会话，
--    所以客户端无法建群拉人。这里用 SECURITY DEFINER 在服务端做，权限在校验里自己把关。
create or replace function public.create_group(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_conv uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_name, ''));
  v_n    int;
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

  insert into public.conversations (id, type, name, created_by)
  values (v_conv, 'group', v_name, v_uid);

  insert into public.conversation_participants (conversation_id, user_id)
  select v_conv, uid from (
    select v_uid as uid
    union
    select unnest(p_member_ids) as uid
  ) s
  where uid is not null
  on conflict (conversation_id, user_id) do nothing;

  return v_conv;
end;
$fn$;

revoke all on function public.create_group(text, uuid[]) from public, anon;
grant execute on function public.create_group(text, uuid[]) to authenticated;

-- ⑧ 顺带：把「谁能建会话」收紧到"只能是自己的会话"
--    原来 conversations_insert 是 with check (auth.uid() is not null)，任何登录用户都能建。
--    保持可建（前端 ensureGlobalConversation 需要），但限制创建者必须是自己。
drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations for insert to authenticated
  with check (created_by is null or created_by = auth.uid());

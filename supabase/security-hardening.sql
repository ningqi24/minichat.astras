-- ============================================================================
-- MiniChat 安全加固 SQL
-- 位置：Supabase Dashboard → SQL Editor（整段粘贴执行）
--
-- 执行顺序建议：
--   第 0 步（只读体检）→ 看清现状 → 第 1~4 步（加固）→ 第 5 步（复核）
--
-- 本脚本针对的体检结论（2026-XX 实际跑出来的状态）：
--   ✅ profiles / messages / conversation_participants 的 RLS 已开启，策略本身是合理的
--   ❌ conversations 的 RLS 是关闭的 → 匿名可直接读写整张表
--   ❌ storage.objects 上存在多条 {public} 策略：匿名可列举桶内容、匿名可上传、
--      任何人可覆盖任何人的头像（permissive 策略是 OR 关系，旧的宽松策略会完全抵消新的严格策略）
--
-- ⚠️ 第 2 步会删除 public 下这四张表的全部既有策略，请先执行并保存第 0 步的输出，
--    以便出问题时对照恢复。执行后请立刻用网站完整走一遍：登录 → 发消息 → 改昵称 →
--    撤回消息 → 上传头像 → 发图片/文件 → 换设备看历史消息。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 第 0 步：体检（只读，不修改任何东西）
-- ----------------------------------------------------------------------------
-- 0.1 哪些表开了 RLS
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
       pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- 0.2 现有策略（重点看 roles 里有没有 anon/public，以及 qual 是不是 true）
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public','storage') order by 1,2,3;

-- 0.3 存储桶（重点看 public 列）
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

-- ============================================================================
-- 第 1 步：开启 RLS
-- ============================================================================
alter table public.profiles                  enable row level security;
alter table public.messages                  enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;

-- ============================================================================
-- 第 2 步：清空这四张表的既有策略（⚠️ 先存好第 0 步的输出）
-- ============================================================================
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('profiles','messages','conversations','conversation_participants')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ============================================================================
-- 第 3 步：最小权限策略
-- ============================================================================
-- profiles：登录用户可看全员资料；只能改自己的
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- messages：登录用户可读全部；只能以自己的邮箱身份写、且只能改自己的
create policy messages_select on public.messages for select to authenticated using (true);
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_email = (auth.jwt() ->> 'email'));
create policy messages_update on public.messages for update to authenticated
  using (sender_email = (auth.jwt() ->> 'email'))
  with check (sender_email = (auth.jwt() ->> 'email'));
-- 不建 delete 策略：网站没有删除消息的功能，任何人都不该能直接删

-- conversations：登录用户可读；首次进入时网站会补建"全局聊天"那一行，所以需要 insert
create policy conversations_select on public.conversations for select to authenticated using (true);
create policy conversations_insert on public.conversations for insert to authenticated
  with check (auth.uid() is not null);
-- 不建 update/delete 策略：会话元数据不该被客户端改动

-- conversation_participants：只能看到/写入自己的参与记录
create policy cp_select on public.conversation_participants for select to authenticated using (user_id = auth.uid());
create policy cp_insert on public.conversation_participants for insert to authenticated with check (user_id = auth.uid());

-- 兜底：显式回收匿名角色对这四张表的表级权限
revoke all on public.profiles, public.messages, public.conversations, public.conversation_participants from anon;

-- ----------------------------------------------------------------------------
-- 关于 public.wake_up_supabase（体检发现的额外表）
-- 它有一条 {anon} INSERT + with_check = true 的策略，用来让外部定时任务给项目"续命"。
-- 保留即可，但要意识到：任何人都能无限往里插行。建议二选一：
--   a) 定期清理：delete from public.wake_up_supabase where created_at < now() - interval '1 day';
--   b) 改成只保留一行的 upsert 模式（需要一个唯一键），从根上杜绝增长。
-- 若这张表已经不用了，直接 drop table public.wake_up_supabase;
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 第 4 步：存储桶
-- 现状问题：anon 可以直接 list 桶内文件（等于能枚举所有人的图片/附件）。
-- 目标：公开桶继续通过 /object/public/... 免登录直读，但匿名不能再列举目录。
-- 上传路径是 public/<文件名>（见 index.html），策略按此收紧。
-- ============================================================================
-- 4.1 清空 storage.objects 上的全部既有策略（⚠️ 先存好第 0.2 步输出）
-- 体检发现的问题策略举例：
--   allow_public_view            SELECT  {public}  bucket_id='chat-images'      → 匿名可列举图片
--   chat-audios 30gmsy_1         SELECT  {public}  bucket_id='chat-audios'      → 匿名可列举音频
--   Allow public read access on chat-files / chat-videos / avatars             → 匿名可列举
--   allow_upload_chat_images     INSERT  {public}  仅校验桶名                    → ⚠️ 匿名也能上传
--   chat-audios 30gmsy_0         INSERT  {public}  仅校验桶名                    → ⚠️ 匿名也能上传
--   avatars 1oj01fe_1            INSERT  {public}  仅校验桶名                    → ⚠️ 匿名也能上传
--   avatars 1oj01fe_2            UPDATE  {public}  仅校验桶名                    → ⚠️ 任何人可覆盖任何人的头像
--   Give all users access to read files  bucket_id='bucket_name'               → 无效残留
do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

-- 4.2 登录用户可读（应用内展示、生成缩略图等）
create policy storage_read_auth on storage.objects for select to authenticated
  using (bucket_id in ('chat-images','chat-audios','chat-videos','chat-files','avatars'));

-- 4.3 登录用户只能往 public/ 前缀上传；头像还必须带上自己的 uid 前缀
create policy storage_insert_auth on storage.objects for insert to authenticated
  with check (
    bucket_id in ('chat-images','chat-audios','chat-videos','chat-files','avatars')
    and (storage.foldername(name))[1] = 'public'
    and (bucket_id <> 'avatars'
         or storage.filename(name) like ('avatar_' || auth.uid()::text || '_%'))
  );

-- 4.4 只能覆盖/删除自己上传的文件
create policy storage_update_own on storage.objects for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy storage_delete_own on storage.objects for delete to authenticated using (owner = auth.uid());

-- ----------------------------------------------------------------------------
-- 第 4.5 步（可选）：给桶补上更严的体积与类型限制
-- 体检结果：chat-files / chat-videos 的 file_size_limit 为 NULL，
--           五个桶的 allowed_mime_types 全为 NULL。
-- ⚠️ 修正：Supabase 里 file_size_limit = NULL 并不是"无限大"，而是继承
--    Project Settings → Storage → "Upload file size limit" 的全局上限
--    （免费版该上限为 50MB）。所以这里并不是在堵"无限上传"，
--    只是把 chat-files 收到 20MB、并给附件桶加上类型白名单。
--    MIME 白名单才是这一步的主要价值。
-- 注意：限制过窄会拒掉正常附件，请对照网站 accept 列表（image/*,audio/*,video/*,
--       .pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip）。
-- ----------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array[
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'text/plain',
         'application/zip',
         'application/x-zip-compressed',
         'application/octet-stream'
       ]
 where id = 'chat-files';

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array[
         'video/mp4','video/webm','video/quicktime','video/x-matroska','video/ogg'
       ]
 where id = 'chat-videos';

-- 说明：octet-stream 保留是为了兼容浏览器识别不出类型的附件；它会被强制当附件下载
--       而不会内联渲染，所以不构成 XSS 载体。allowed_mime_types 只挡正常客户端，
--       直连 Storage API 仍可伪造 Content-Type，属于纵深防御而非唯一防线。

-- ============================================================================
-- 第 6 步：发消息限流（数据库层强制，客户端无法绕过）
-- 说明：网站是直接用 anon key 往 messages 表 insert 的，不走 Edge Function，
--       所以限流必须放在数据库里才有意义。下面这个触发器让同一邮箱
--       每分钟最多插入 20 条，超了直接报错。
-- ============================================================================
create or replace function public.messages_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  select count(*) into recent
    from public.messages
   where sender_email = new.sender_email
     and created_at > now() - interval '1 minute';
  if recent >= 20 then
    raise exception '发送过于频繁，请稍后再试' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.messages_rate_limit();

-- 想放宽/收紧就改上面那个 20。临时停用：alter table public.messages disable trigger messages_rate_limit;

-- ============================================================================
-- 第 7 步：清理 public.wake_up_supabase（续命表）
-- 现状：有一条 {anon} INSERT + with_check = true 的策略，任何人都能无限往里插行。
-- 目标：保留续命能力，但每天自动清掉旧行，避免无限增长。
-- 若 create extension 报权限错误，请先到 Dashboard → Database → Extensions 启用 pg_cron。
-- ============================================================================
create extension if not exists pg_cron;

do $$
declare
  tcol text;
begin
  select column_name into tcol
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'wake_up_supabase'
     and data_type like 'timestamp%'
   order by ordinal_position
   limit 1;

  if tcol is null then
    raise notice 'wake_up_supabase 里没有时间列，跳过自动清理：请手动确认表结构。';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'cleanup-wake-up-supabase';

  perform cron.schedule(
    'cleanup-wake-up-supabase',
    '17 4 * * *',
    format('delete from public.wake_up_supabase where %I < now() - interval ''2 days''', tcol)
  );

  raise notice '已按列 % 创建每日清理任务 cleanup-wake-up-supabase', tcol;
end $$;

-- 查看/管理：
--   select jobid, jobname, schedule, command from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
-- 如果这张表已经不用了，可以直接：drop table public.wake_up_supabase;

-- ============================================================================
-- 最后一步：复核（在跑完第 1~7 步之后执行）
-- 期望结果：四张表 rls_enabled = true，且没有任何 anon/public 策略
-- ============================================================================
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('profiles','messages','conversations','conversation_participants') order by 1;

select tablename, policyname, roles, cmd from pg_policies
where schemaname in ('public','storage') order by 1,2;

-- ============================================================================
-- 出问题时整体回退（⛔ 谨慎执行，等于回到『谁都能读写』的状态）
-- ============================================================================
-- do $$ declare r record; begin
--   for r in select tablename, policyname from pg_policies
--            where schemaname = 'public'
--              and tablename in ('profiles','messages','conversations','conversation_participants')
--   loop execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
-- end $$;
-- alter table public.profiles disable row level security;
-- alter table public.messages disable row level security;
-- alter table public.conversations disable row level security;
-- alter table public.conversation_participants disable row level security;

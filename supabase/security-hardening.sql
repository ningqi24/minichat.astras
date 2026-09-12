-- ============================================================================
-- MiniChat 安全加固 SQL
-- 位置：Supabase Dashboard → SQL Editor（整段粘贴执行）
--
-- 执行顺序建议：
--   第 0 步（只读体检）→ 看清现状 → 第 1~4 步（加固）→ 第 5 步（复核）
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

-- conversations：只读
create policy conversations_select on public.conversations for select to authenticated using (true);

-- conversation_participants：只能看到/写入自己的参与记录
create policy cp_select on public.conversation_participants for select to authenticated using (user_id = auth.uid());
create policy cp_insert on public.conversation_participants for insert to authenticated with check (user_id = auth.uid());

-- 兜底：显式回收匿名角色对这四张表的表级权限
revoke all on public.profiles, public.messages, public.conversations, public.conversation_participants from anon;

-- ============================================================================
-- 第 4 步：存储桶
-- 现状问题：anon 可以直接 list 桶内文件（等于能枚举所有人的图片/附件）。
-- 目标：公开桶继续通过 /object/public/... 免登录直读，但匿名不能再列举目录。
-- 上传路径是 public/<文件名>（见 index.html），策略按此收紧。
-- ============================================================================
-- 4.1 删掉把读取权限发给 anon / public 的策略
do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and (roles && array['anon','public']::name[])
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

-- 4.2 登录用户可读（应用内展示、生成缩略图等）
create policy storage_read_auth on storage.objects for select to authenticated
  using (bucket_id in ('chat-images','chat-audios','chat-videos','chat-files','avatars'));

-- 4.3 登录用户只能往 public/ 前缀上传
create policy storage_insert_auth on storage.objects for insert to authenticated
  with check (bucket_id in ('chat-images','chat-audios','chat-videos','chat-files','avatars')
              and (storage.foldername(name))[1] = 'public');

-- 4.4 只能覆盖/删除自己上传的文件
create policy storage_update_own on storage.objects for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy storage_delete_own on storage.objects for delete to authenticated using (owner = auth.uid());

-- ----------------------------------------------------------------------------
-- 第 4.5 步（可选，建议）：给没有上限的桶补上体积与类型限制
-- 体检结果：chat-files / chat-videos 的 file_size_limit 为 NULL（= 不限体积），
--           五个桶的 allowed_mime_types 全为 NULL（= 任意类型可传）。
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
-- 第 5 步：复核（应为：四张表 rls_enabled = true，且没有任何 anon/public 策略）
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

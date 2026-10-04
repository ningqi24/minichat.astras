-- ============================================================================
-- 第 1 期加固：建群每日限额（好友体系上线前的临时护栏）
-- ============================================================================
-- ⚠️ 说明清楚这只是【临时护栏】，不是最终方案：
--   真正的解法是在好友体系（第 2 期）上线后，让 create_group 校验
--   "只能把【好友】拉进群"（或者至少要对方同意）。
--   在那之前，任何人都能把任何人拉进群 —— 这是当前实现的已知缺口。
--   这里先用每日建群上限把"批量拉人建群"的成本抬高一点。
--
-- 可重复执行。依赖 rate_limit 表（第 0 期已建）。
-- ============================================================================

-- 建群时登记一次配额：每账号每天最多 5 个群
create or replace function public.create_group_quota(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ok boolean;
begin
  select public.rate_limit_hit('group_create:' || p_uid::text, 5, 24 * 60 * 60 * 1000)
    into v_ok;
  if not v_ok then
    raise exception 'group_create_too_frequent'
      using errcode = '22023',
            hint = '每天最多创建 5 个群，请稍后再试';
  end if;
end;
$fn$;

revoke all on function public.create_group_quota(uuid) from public, anon, authenticated;

-- 让 create_group 调用它
create or replace function public.create_group(
  p_name           text,
  p_member_ids     uuid[],
  p_bridge_visible boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_conv uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_name, ''));
  v_no   text;
  v_n    int;
  v_try  int := 0;
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

  -- 临时护栏：每账号每天最多 5 个群
  perform public.create_group_quota(v_uid);

  loop
    v_try := v_try + 1;
    v_no := (floor(random() * 90000000) + 10000000)::bigint::text;
    exit when not exists (select 1 from public.conversations where group_no = v_no);
    if v_try >= 20 then
      raise exception 'group_no_generation_failed' using errcode = '22023';
    end if;
  end loop;

  insert into public.conversations (id, type, name, created_by, group_no, bridge_visible)
  values (v_conv, 'group', v_name, v_uid, v_no, coalesce(p_bridge_visible, true));

  insert into public.conversation_participants (conversation_id, user_id, role)
  select v_conv, uid, case when uid = v_uid then 'owner' else 'member' end
    from (
      select v_uid as uid
      union
      select unnest(p_member_ids) as uid
    ) s
   where uid is not null
  on conflict (conversation_id, user_id) do nothing;

  return v_conv;
end;
$fn$;

revoke all on function public.create_group(text, uuid[], boolean) from public, anon;
grant execute on function public.create_group(text, uuid[], boolean) to authenticated;

select '建群每日限额已启用（每账号每天 5 个）' as "结果";

CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_member_ids uuid[], p_bridge_visible boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 第 2/4 期补充：只能把【已经是好友】的人拉进群。
  -- 之前没有这个校验，任何人都能把任意用户拉进群（用户明确反馈要修）。
  -- 走 are_friends()（SECURITY DEFINER）而不是直接查 friendships，避免受 RLS 影响。
  select count(*) into v_n
    from unnest(p_member_ids) as x
   where x is not null and x <> v_uid and not public.are_friends(v_uid, x);
  if v_n > 0 then
    raise exception 'members_must_be_friends' using errcode = '42501',
      hint = '只能邀请好友加入群聊，请先加对方为好友';
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
$function$;

select '✅ create_group 已加上好友校验（members_must_be_friends）' as "结果";
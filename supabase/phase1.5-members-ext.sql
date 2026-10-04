drop function if exists public.list_conversation_members(uuid);

create or replace function public.list_conversation_members(p_conversation_id uuid)
returns table (
  user_id      uuid,
  email        text,
  display_name text,
  avatar_url   text,
  bio          text,
  role         text,
  joined_at    timestamptz,
  group_nick   text,
  muted_until  timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.conversation_participants cp
     where cp.conversation_id = p_conversation_id and cp.user_id = v_uid
  ) into v_ok;
  if not v_ok then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  return query
    select p.id, p.email, p.display_name, p.avatar_url, p.bio, cp.role, cp.joined_at,
           cp.group_nick, cp.muted_until
      from public.conversation_participants cp
      join public.profiles p on p.id = cp.user_id
     where cp.conversation_id = p_conversation_id
     order by
       case cp.role when 'owner' then 0 when 'admin' then 1 else 2 end,
       cp.joined_at asc;
end;
$fn$;

revoke all on function public.list_conversation_members(uuid) from public, anon;
grant execute on function public.list_conversation_members(uuid) to authenticated;

select '✅ list_conversation_members 已重建（含 group_nick / muted_until）' as "结果";

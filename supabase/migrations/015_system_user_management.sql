-- System-level user lifecycle management. All access is kept behind security-definer
-- functions that explicitly verify the current user is a system administrator.

alter table public.profiles
  add column if not exists lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active','archived'));
alter table public.profiles add column if not exists archived_at timestamptz;

create index if not exists profiles_lifecycle_created_idx
  on public.profiles(lifecycle_status,created_at desc);

create or replace function public.system_admin_users(p_limit integer default 100,p_offset integer default 0)
returns table(
  user_id uuid,
  first_name text,
  last_name text,
  lifecycle_status text,
  is_system_admin boolean,
  group_count bigint,
  owned_group_count bigint,
  created_at timestamptz
)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_system_admin() then raise exception 'אין הרשאת מערכת'; end if;
  return query
  select p.id,p.first_name,p.last_name,p.lifecycle_status,p.is_system_admin,
    (select count(*)
     from public.group_members gm
     join public.groups g on g.id=gm.group_id
     where gm.user_id=p.id
       and gm.status='active'
       and g.lifecycle_status='active'),
    (select count(*) from public.groups g where g.owner_id=p.id and g.lifecycle_status<>'deleted'),
    p.created_at
  from public.profiles p
  order by p.created_at desc
  limit greatest(1,least(p_limit,200)) offset greatest(p_offset,0);
end $$;
grant execute on function public.system_admin_users(integer,integer) to authenticated;

create or replace function public.system_admin_manage_user(p_user_id uuid,p_action text)
returns void language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles;
begin
  if not public.is_system_admin() then raise exception 'אין הרשאת מערכת'; end if;
  if p_user_id=(select auth.uid()) then raise exception 'לא ניתן לבצע פעולה על חשבון האדמין המחובר'; end if;

  select * into v_profile from public.profiles where id=p_user_id for update;
  if not found then raise exception 'המשתמש לא נמצא'; end if;
  if v_profile.is_system_admin then raise exception 'לא ניתן להסיר או לארכב מנהל מערכת אחר'; end if;

  if p_action='archive' then
    update public.profiles set lifecycle_status='archived',archived_at=now() where id=p_user_id;
    update auth.users set banned_until='infinity'::timestamptz where id=p_user_id;
    delete from auth.sessions where user_id=p_user_id;
  elsif p_action='restore' then
    update public.profiles set lifecycle_status='active',archived_at=null where id=p_user_id;
    update auth.users set banned_until=null where id=p_user_id;
  elsif p_action='delete' then
    if exists(select 1 from public.groups where owner_id=p_user_id) then
      raise exception 'לא ניתן למחוק משתמש שבבעלותו קבוצה. יש להעביר קודם את הבעלות.';
    end if;
    delete from auth.users where id=p_user_id;
  else
    raise exception 'פעולה לא תקינה';
  end if;
end $$;
grant execute on function public.system_admin_manage_user(uuid,text) to authenticated;

create or replace function public.system_admin_overview()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_system_admin() then raise exception 'אין הרשאת מערכת'; end if;
 return jsonb_build_object(
  'users',(select count(*) from public.profiles),
  'active_users',(select count(*) from public.profiles where lifecycle_status='active'),
  'archived_users',(select count(*) from public.profiles where lifecycle_status='archived'),
  'groups',(select count(*) from public.groups),
  'active_groups',(select count(*) from public.groups where lifecycle_status='active'),
  'archived_groups',(select count(*) from public.groups where lifecycle_status='archived'),
  'matches',(select count(*) from public.matches),
  'pending_requests',(select count(*) from public.group_join_requests where status='pending'),
  'new_users_30d',(select count(*) from public.profiles where created_at>=now()-interval '30 days')
 );
end $$;
grant execute on function public.system_admin_overview() to authenticated;

-- A system administrator may manage a member of any group, while a group admin
-- remains limited to memberships in their own group.
create or replace function public.remove_group_member(p_member_id uuid,p_permanent boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare m public.group_members;
begin
  select * into m from public.group_members where id=p_member_id;
  if not found then raise exception 'השחקן לא נמצא'; end if;
  if not (public.is_group_admin(m.group_id) or public.is_system_admin()) then raise exception 'אין הרשאה להסיר שחקן מהקבוצה הזאת'; end if;
  if m.role='admin' then raise exception 'לא ניתן להסיר את מנהל הקבוצה'; end if;
  if p_permanent then
    -- Permanent in the group context means deleting this membership only. The
    -- user's account and memberships in other groups must remain untouched.
    delete from public.group_members where id=p_member_id;
  else
    update public.group_members set status='inactive' where id=p_member_id;
  end if;
end $$;
grant execute on function public.remove_group_member(uuid,boolean) to authenticated;

create or replace function public.restore_group_member(p_member_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare m public.group_members;
begin
  select * into m from public.group_members where id=p_member_id;
  if not found then raise exception 'השחקן לא נמצא'; end if;
  if not (public.is_group_admin(m.group_id) or public.is_system_admin()) then raise exception 'אין הרשאה לשחזר שחקן בקבוצה הזאת'; end if;
  update public.group_members set status='active' where id=p_member_id;
end $$;
grant execute on function public.restore_group_member(uuid) to authenticated;

-- Granular group permissions for polls, members and team management.
-- Admins keep full access; delegated members receive only explicitly granted capabilities.

insert into public.permissions(key,label) values
  ('manage_polls','ניהול סקרים')
on conflict (key) do update set label=excluded.label;

do $$ begin
 alter publication supabase_realtime add table public.member_permissions;
exception when duplicate_object then null; end $$;

create or replace function public.has_group_permission(p_group uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(
  select 1
  from public.group_members gm
  join public.groups g on g.id=gm.group_id
  where gm.group_id=p_group
    and gm.user_id=(select auth.uid())
    and gm.status='active'
    and (
      gm.role='admin'
      or g.owner_id=(select auth.uid())
      or exists(
        select 1 from public.member_permissions mp
        where mp.group_member_id=gm.id and mp.permission_key=p_permission
      )
    )
 )
$$;

-- Permission assignment is intentionally admin-only: a delegated manager cannot
-- grant additional capabilities to themselves or to somebody else.
create or replace function public.set_group_member_permission(
 p_member_id uuid,p_permission text,p_enabled boolean
) returns void language plpgsql security definer set search_path=public as $$
declare m public.group_members; v_actor uuid:=(select auth.uid());
begin
 select * into m from public.group_members where id=p_member_id for update;
 if not found then raise exception 'השחקן לא נמצא'; end if;
 if not public.is_group_admin(m.group_id) and not public.is_group_owner(m.group_id) then
  raise exception 'רק מנהל הקבוצה יכול לעדכן הרשאות';
 end if;
 if m.role='admin' then raise exception 'למנהל הקבוצה כבר יש הרשאה מלאה'; end if;
 if m.status<>'active' then raise exception 'לא ניתן לתת הרשאה לשחקן שאינו פעיל'; end if;
 if p_permission='manage_permissions' or not exists(select 1 from public.permissions where key=p_permission) then
  raise exception 'ההרשאה אינה ניתנת להקצאה';
 end if;
 if p_enabled then
  insert into public.member_permissions(group_member_id,permission_key,granted_by)
  values(p_member_id,p_permission,v_actor)
  on conflict(group_member_id,permission_key) do nothing;
 else
  delete from public.member_permissions
  where group_member_id=p_member_id and permission_key=p_permission;
 end if;
 perform public.log_group_audit(
  m.group_id,
  case when p_enabled then 'permission.granted' else 'permission.revoked' end,
  'group_member',p_member_id,null,
  jsonb_build_object('permission',p_permission,'enabled',p_enabled)
 );
end $$;
revoke all on function public.set_group_member_permission(uuid,text,boolean) from public,anon;
grant execute on function public.set_group_member_permission(uuid,text,boolean) to authenticated;

-- Poll creation and lifecycle management.
drop policy if exists "polls created by admins" on public.weekly_polls;
drop policy if exists "polls updated by admins" on public.weekly_polls;
drop policy if exists "polls deleted by admins" on public.weekly_polls;
drop policy if exists "polls created by managers" on public.weekly_polls;
drop policy if exists "polls updated by managers" on public.weekly_polls;
drop policy if exists "polls deleted by managers" on public.weekly_polls;
create policy "polls created by managers" on public.weekly_polls for insert to authenticated
 with check(public.has_group_permission(group_id,'manage_polls') and created_by=(select auth.uid()));
create policy "polls updated by managers" on public.weekly_polls for update to authenticated
 using(public.has_group_permission(group_id,'manage_polls'))
 with check(public.has_group_permission(group_id,'manage_polls'));
create policy "polls deleted by managers" on public.weekly_polls for delete to authenticated
 using(public.has_group_permission(group_id,'manage_polls'));

create or replace function public.duplicate_weekly_poll(p_poll_id uuid,p_week_start date default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare src public.weekly_polls; new_id uuid;
begin
 select * into src from public.weekly_polls where id=p_poll_id;
 if not found or not public.has_group_permission(src.group_id,'manage_polls') then
  raise exception 'אין הרשאה לשכפל את הסקר';
 end if;
 insert into public.weekly_polls(group_id,created_by,week_start,status,title,description)
 values(src.group_id,(select auth.uid()),coalesce(p_week_start,src.week_start+7),'open',src.title,src.description)
 returning id into new_id;
 return new_id;
end $$;
revoke all on function public.duplicate_weekly_poll(uuid,date) from public,anon;
grant execute on function public.duplicate_weekly_poll(uuid,date) to authenticated;

-- A member manager can approve join requests and archive, restore or remove
-- non-admin members. They can never remove themselves or a group admin.
create or replace function public.remove_group_member(p_member_id uuid,p_permanent boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare m public.group_members; v_actor uuid:=(select auth.uid());
begin
 select * into m from public.group_members where id=p_member_id for update;
 if not found then raise exception 'השחקן לא נמצא'; end if;
 if not (public.is_group_admin(m.group_id) or public.has_group_permission(m.group_id,'manage_members') or public.is_system_admin()) then
  raise exception 'אין הרשאה לנהל שחקנים בקבוצה הזאת';
 end if;
 if m.role='admin' then raise exception 'לא ניתן להסיר את מנהל הקבוצה'; end if;
 if m.user_id=v_actor and not public.is_system_admin() then raise exception 'לא ניתן להסיר את עצמך מהקבוצה דרך מסך הניהול'; end if;
 if p_permanent then delete from public.group_members where id=p_member_id;
 else update public.group_members set status='inactive' where id=p_member_id; end if;
 perform public.log_group_audit(m.group_id,case when p_permanent then 'member.removed' else 'member.archived' end,'group_member',p_member_id,null,null);
end $$;

create or replace function public.restore_group_member(p_member_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare m public.group_members;
begin
 select * into m from public.group_members where id=p_member_id for update;
 if not found then raise exception 'השחקן לא נמצא'; end if;
 if not (public.is_group_admin(m.group_id) or public.has_group_permission(m.group_id,'manage_members') or public.is_system_admin()) then
  raise exception 'אין הרשאה לנהל שחקנים בקבוצה הזאת';
 end if;
 if m.role='admin' then raise exception 'לא ניתן לשנות את מצב מנהל הקבוצה'; end if;
 update public.group_members set status='active' where id=p_member_id;
 perform public.log_group_audit(m.group_id,'member.restored','group_member',p_member_id,null,null);
end $$;
revoke all on function public.remove_group_member(uuid,boolean) from public,anon;
revoke all on function public.restore_group_member(uuid) from public,anon;
grant execute on function public.remove_group_member(uuid,boolean) to authenticated;
grant execute on function public.restore_group_member(uuid) to authenticated;

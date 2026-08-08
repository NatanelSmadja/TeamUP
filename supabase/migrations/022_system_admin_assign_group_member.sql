-- Allow only the system administrator to attach an existing user to an active group.

create or replace function public.system_admin_assign_user_to_group(p_user_id uuid,p_group_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare p public.profiles;g public.groups;v_existing public.group_members;
begin
 if not public.is_system_admin() then raise exception 'אין הרשאת מערכת'; end if;
 select * into p from public.profiles where id=p_user_id for update;
 if not found then raise exception 'המשתמש לא נמצא'; end if;
 if p.lifecycle_status<>'active' then raise exception 'יש לשחזר את המשתמש מהארכיון לפני שיוך לקבוצה'; end if;
 select * into g from public.groups where id=p_group_id for update;
 if not found then raise exception 'הקבוצה לא נמצאה'; end if;
 if g.lifecycle_status<>'active' then raise exception 'ניתן לשייך שחקנים רק לקבוצה פעילה'; end if;
 select * into v_existing from public.group_members where group_id=p_group_id and user_id=p_user_id;
 if found and v_existing.status='active' then raise exception 'השחקן כבר חבר פעיל בקבוצה'; end if;

 insert into public.group_members(group_id,user_id,role,status)
 values(p_group_id,p_user_id,case when g.owner_id=p_user_id then 'admin'::public.member_role else 'player'::public.member_role end,'active')
 on conflict(group_id,user_id) do update set
  status='active',
  role=case when g.owner_id=p_user_id then 'admin'::public.member_role else public.group_members.role end;

 insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
 values(p_user_id,'group_assignment','שויכת לקבוצה','אדמין המערכת שייך אותך לקבוצה '||g.name,'group',p_group_id);
 perform public.log_group_audit(p_group_id,'system.member_assigned','member',p_user_id,
  case when v_existing.id is null then null else jsonb_build_object('status',v_existing.status,'role',v_existing.role) end,
  jsonb_build_object('status','active','assigned_by',(select auth.uid())));
end $$;
revoke all on function public.system_admin_assign_user_to_group(uuid,uuid) from public,anon;
grant execute on function public.system_admin_assign_user_to_group(uuid,uuid) to authenticated;

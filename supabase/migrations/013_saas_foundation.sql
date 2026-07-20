-- TEAMUP V3: SaaS foundation (no billing/plans)

alter table public.groups add column if not exists slug text;
alter table public.groups add column if not exists visibility text not null default 'public' check (visibility in ('public','private'));
alter table public.groups add column if not exists join_mode text not null default 'approval_required' check (join_mode in ('open','approval_required','invite_only'));
alter table public.groups add column if not exists lifecycle_status text not null default 'active' check (lifecycle_status in ('active','archived','suspended','deleted'));
alter table public.groups add column if not exists archived_at timestamptz;
alter table public.groups add column if not exists deleted_at timestamptz;
alter table public.groups add column if not exists invite_code text;
alter table public.groups add column if not exists theme_color text not null default '#2563eb';
alter table public.groups add column if not exists updated_at timestamptz not null default now();

update public.groups set slug=lower(regexp_replace(coalesce(name,'teamup')||'-'||left(id::text,8),'[^a-zA-Z0-9א-ת]+','-','g')) where slug is null;
update public.groups set invite_code=upper(substr(md5(id::text||clock_timestamp()::text),1,8)) where invite_code is null;

create unique index if not exists groups_slug_unique_idx on public.groups(slug);
create unique index if not exists groups_invite_code_unique_idx on public.groups(invite_code);
create index if not exists groups_lifecycle_visibility_idx on public.groups(lifecycle_status,visibility,created_at desc);
create index if not exists group_members_group_status_user_idx on public.group_members(group_id,status,user_id);
create index if not exists group_members_user_status_idx on public.group_members(user_id,status,group_id);
create index if not exists group_join_requests_group_status_created_idx on public.group_join_requests(group_id,status,created_at);
create index if not exists matches_group_date_status_idx on public.matches(group_id,match_date desc,status);
create index if not exists notifications_user_read_created_idx on public.notifications(user_id,is_read,created_at desc);
create index if not exists audit_logs_group_created_idx on public.audit_logs(group_id,created_at desc);

create or replace function public.is_system_admin()
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select is_system_admin from public.profiles where id=(select auth.uid())),false)
$$;
grant execute on function public.is_system_admin() to authenticated;

create or replace function public.is_group_owner(p_group_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.groups where id=p_group_id and owner_id=(select auth.uid()))
$$;
grant execute on function public.is_group_owner(uuid) to authenticated;

create or replace function public.log_group_audit(p_group_id uuid,p_action text,p_entity_type text,p_entity_id uuid default null,p_old jsonb default null,p_new jsonb default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 insert into public.audit_logs(group_id,performed_by,action,entity_type,entity_id,old_data,new_data)
 values(p_group_id,(select auth.uid()),p_action,p_entity_type,p_entity_id,p_old,p_new);
end $$;
grant execute on function public.log_group_audit(uuid,text,text,uuid,jsonb,jsonb) to authenticated;

create or replace function public.create_teamup_group(
 p_name text,p_description text default null,p_location text default null,
 p_visibility text default 'public',p_join_mode text default 'approval_required',p_theme_color text default '#2563eb'
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=(select auth.uid());v_group uuid;v_slug text;v_code text;
begin
 if v_user is null then raise exception 'Not authenticated'; end if;
 if nullif(trim(p_name),'') is null then raise exception 'יש להזין שם קבוצה'; end if;
 if p_visibility not in ('public','private') then raise exception 'סוג קבוצה לא תקין'; end if;
 if p_join_mode not in ('open','approval_required','invite_only') then raise exception 'מדיניות הצטרפות לא תקינה'; end if;
 v_slug:=lower(regexp_replace(trim(p_name)||'-'||substr(md5(gen_random_uuid()::text),1,6),'[^a-zA-Z0-9א-ת]+','-','g'));
 v_code:=upper(substr(md5(gen_random_uuid()::text||clock_timestamp()::text),1,8));
 insert into public.groups(name,description,owner_id,default_location,slug,visibility,join_mode,invite_code,theme_color,lifecycle_status)
 values(trim(p_name),nullif(trim(coalesce(p_description,'')),''),v_user,nullif(trim(coalesce(p_location,'')),''),v_slug,p_visibility,p_join_mode,v_code,coalesce(nullif(p_theme_color,''),'#2563eb'),'active')
 returning id into v_group;
 insert into public.group_members(group_id,user_id,role,status) values(v_group,v_user,'admin','active');
 perform public.log_group_audit(v_group,'group.created','group',v_group,null,jsonb_build_object('name',trim(p_name)));
 return v_group;
end $$;
grant execute on function public.create_teamup_group(text,text,text,text,text,text) to authenticated;

create or replace function public.request_group_join(p_group_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=(select auth.uid());v_group public.groups;v_admin record;
begin
 if v_user is null then raise exception 'Not authenticated'; end if;
 select * into v_group from public.groups where id=p_group_id and lifecycle_status='active';
 if not found then raise exception 'הקבוצה אינה זמינה'; end if;
 if v_group.join_mode='invite_only' then raise exception 'ניתן להצטרף לקבוצה זו רק באמצעות קישור הזמנה'; end if;
 if exists(select 1 from public.group_members where group_id=p_group_id and user_id=v_user and status='active') then raise exception 'אתה כבר חבר בקבוצה'; end if;
 if v_group.join_mode='open' then
   insert into public.group_members(group_id,user_id,role,status) values(p_group_id,v_user,'player','active')
   on conflict(group_id,user_id) do update set status='active',role='player';
   insert into public.group_join_requests(group_id,user_id,status,reviewed_by,reviewed_at)
   values(p_group_id,v_user,'approved',v_user,now()) on conflict(group_id,user_id) do update set status='approved',reviewed_by=v_user,reviewed_at=now(),updated_at=now();
 else
   insert into public.group_join_requests(group_id,user_id,status,reviewed_by,reviewed_at)
   values(p_group_id,v_user,'pending',null,null) on conflict(group_id,user_id) do update set status='pending',reviewed_by=null,reviewed_at=null,updated_at=now();
   for v_admin in select distinct gm.user_id from public.group_members gm where gm.group_id=p_group_id and gm.status='active' and (gm.role in ('admin','moderator') or exists(select 1 from public.member_permissions mp where mp.group_member_id=gm.id and mp.permission_key='manage_members')) loop
     insert into public.notifications(user_id,type,title,message,entity_type,entity_id) values(v_admin.user_id,'group_join_request','בקשת הצטרפות חדשה','שחקן חדש מבקש להצטרף ל־'||v_group.name,'group',p_group_id);
   end loop;
 end if;
end $$;

create or replace function public.join_group_by_invite(p_code text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_group public.groups;v_user uuid:=(select auth.uid());
begin
 select * into v_group from public.groups where upper(invite_code)=upper(trim(p_code)) and lifecycle_status='active';
 if not found then raise exception 'קישור או קוד ההזמנה אינו תקין'; end if;
 insert into public.group_members(group_id,user_id,role,status) values(v_group.id,v_user,'player','active')
 on conflict(group_id,user_id) do update set status='active',role=case when public.group_members.role='admin' then 'admin'::public.member_role else 'player'::public.member_role end;
 insert into public.group_join_requests(group_id,user_id,status,reviewed_by,reviewed_at) values(v_group.id,v_user,'approved',v_group.owner_id,now())
 on conflict(group_id,user_id) do update set status='approved',reviewed_by=v_group.owner_id,reviewed_at=now(),updated_at=now();
 return v_group.id;
end $$;
grant execute on function public.join_group_by_invite(text) to authenticated;

create or replace function public.rotate_group_invite_code(p_group_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare v_code text;
begin
 if not public.is_group_owner(p_group_id) then raise exception 'רק בעל הקבוצה יכול להחליף קוד הזמנה'; end if;
 v_code:=upper(substr(md5(gen_random_uuid()::text||clock_timestamp()::text),1,8));
 update public.groups set invite_code=v_code,updated_at=now() where id=p_group_id;
 perform public.log_group_audit(p_group_id,'invite.rotated','group',p_group_id,null,null);
 return v_code;
end $$;
grant execute on function public.rotate_group_invite_code(uuid) to authenticated;

create or replace function public.archive_group(p_group_id uuid,p_restore boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not (public.is_group_owner(p_group_id) or public.is_system_admin()) then raise exception 'אין הרשאה'; end if;
 if p_restore then
  update public.groups set lifecycle_status='active',archived_at=null,updated_at=now() where id=p_group_id;
  perform public.log_group_audit(p_group_id,'group.restored','group',p_group_id,null,null);
 else
  update public.groups set lifecycle_status='archived',archived_at=now(),updated_at=now() where id=p_group_id;
  perform public.log_group_audit(p_group_id,'group.archived','group',p_group_id,null,null);
 end if;
end $$;
grant execute on function public.archive_group(uuid,boolean) to authenticated;

create or replace function public.transfer_group_ownership(p_group_id uuid,p_new_owner uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_old uuid;
begin
 select owner_id into v_old from public.groups where id=p_group_id for update;
 if v_old<>(select auth.uid()) and not public.is_system_admin() then raise exception 'רק בעל הקבוצה יכול להעביר בעלות'; end if;
 if not exists(select 1 from public.group_members where group_id=p_group_id and user_id=p_new_owner and status='active') then raise exception 'הבעלים החדש חייב להיות חבר פעיל בקבוצה'; end if;
 update public.groups set owner_id=p_new_owner,updated_at=now() where id=p_group_id;
 update public.group_members set role='admin' where group_id=p_group_id and user_id=p_new_owner;
 update public.group_members set role='moderator' where group_id=p_group_id and user_id=v_old and v_old<>p_new_owner;
 perform public.log_group_audit(p_group_id,'ownership.transferred','group',p_group_id,jsonb_build_object('owner_id',v_old),jsonb_build_object('owner_id',p_new_owner));
end $$;
grant execute on function public.transfer_group_ownership(uuid,uuid) to authenticated;

create or replace function public.discover_groups()
returns table(group_id uuid,group_name text,description text,default_location text,owner_name text,member_count bigint,membership_status text,request_status text,visibility text,join_mode text,slug text,theme_color text)
language sql stable security definer set search_path=public as $$
 select g.id,g.name,g.description,g.default_location,trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),
 (select count(*) from public.group_members gm where gm.group_id=g.id and gm.status='active'),
 case when g.owner_id=(select auth.uid()) then 'active' else (select gm.status::text from public.group_members gm where gm.group_id=g.id and gm.user_id=(select auth.uid()) order by gm.joined_at desc limit 1) end,
 case when g.owner_id=(select auth.uid()) or exists(select 1 from public.group_members gm where gm.group_id=g.id and gm.user_id=(select auth.uid()) and gm.status='active') then null else (select r.status from public.group_join_requests r where r.group_id=g.id and r.user_id=(select auth.uid()) order by r.updated_at desc limit 1) end,
 g.visibility,g.join_mode,g.slug,g.theme_color
 from public.groups g join public.profiles p on p.id=g.owner_id
 where g.lifecycle_status='active' and (g.visibility='public' or exists(select 1 from public.group_members gm where gm.group_id=g.id and gm.user_id=(select auth.uid()) and gm.status='active'))
 order by g.created_at desc;
$$;

create or replace function public.group_dashboard_summary(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from public.group_members where group_id=p_group_id and user_id=(select auth.uid()) and status='active') then raise exception 'אין גישה לקבוצה'; end if;
 return jsonb_build_object(
  'members',(select count(*) from public.group_members where group_id=p_group_id and status='active'),
  'pending_requests',(select count(*) from public.group_join_requests where group_id=p_group_id and status='pending'),
  'open_matches',(select count(*) from public.matches where group_id=p_group_id and status='registration_open'),
  'upcoming_matches',(select count(*) from public.matches where group_id=p_group_id and match_date>=current_date),
  'polls_open',(select count(*) from public.weekly_polls where group_id=p_group_id and status='open')
 );
end $$;
grant execute on function public.group_dashboard_summary(uuid) to authenticated;

create or replace function public.system_admin_overview()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_system_admin() then raise exception 'אין הרשאת מערכת'; end if;
 return jsonb_build_object(
  'users',(select count(*) from public.profiles),
  'groups',(select count(*) from public.groups),
  'active_groups',(select count(*) from public.groups where lifecycle_status='active'),
  'archived_groups',(select count(*) from public.groups where lifecycle_status='archived'),
  'matches',(select count(*) from public.matches),
  'pending_requests',(select count(*) from public.group_join_requests where status='pending'),
  'new_users_30d',(select count(*) from public.profiles where created_at>=now()-interval '30 days')
 );
end $$;
grant execute on function public.system_admin_overview() to authenticated;

create or replace function public.system_admin_groups(p_limit integer default 50,p_offset integer default 0)
returns table(group_id uuid,name text,owner_name text,lifecycle_status text,visibility text,join_mode text,member_count bigint,created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_system_admin() then raise exception 'אין הרשאת מערכת'; end if;
 return query select g.id,g.name,trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),g.lifecycle_status,g.visibility,g.join_mode,
 (select count(*) from public.group_members gm where gm.group_id=g.id and gm.status='active'),g.created_at
 from public.groups g join public.profiles p on p.id=g.owner_id order by g.created_at desc limit greatest(1,least(p_limit,100)) offset greatest(p_offset,0);
end $$;
grant execute on function public.system_admin_groups(integer,integer) to authenticated;

-- Group visibility: active members can read full rows; public active groups are discoverable.
drop policy if exists "groups visible to authenticated" on public.groups;
create policy "groups discoverable or member visible" on public.groups for select to authenticated using(
 lifecycle_status='active' and visibility='public'
 or owner_id=(select auth.uid())
 or exists(select 1 from public.group_members gm where gm.group_id=id and gm.user_id=(select auth.uid()) and gm.status='active')
 or public.is_system_admin()
);

-- Audit logs remain tenant isolated, with system admin access.
drop policy if exists "audit admins" on public.audit_logs;
create policy "audit managers or system admin" on public.audit_logs for select to authenticated using(
 public.is_system_admin() or (group_id is not null and (public.is_group_admin(group_id) or public.has_group_permission(group_id,'manage_members')))
);

create or replace function public.my_archived_groups()
returns table(group_id uuid,name text,description text,archived_at timestamptz,theme_color text)
language sql stable security definer set search_path=public as $$
 select g.id,g.name,g.description,g.archived_at,g.theme_color
 from public.groups g where g.owner_id=(select auth.uid()) and g.lifecycle_status='archived'
 order by g.archived_at desc;
$$;
grant execute on function public.my_archived_groups() to authenticated;

create or replace function public.system_set_group_status(p_group_id uuid,p_status text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_system_admin() then raise exception 'אין הרשאת מערכת'; end if;
 if p_status not in ('active','archived','suspended') then raise exception 'סטטוס לא תקין'; end if;
 update public.groups set lifecycle_status=p_status,archived_at=case when p_status='archived' then now() else null end,updated_at=now() where id=p_group_id;
 perform public.log_group_audit(p_group_id,'system.status_changed','group',p_group_id,null,jsonb_build_object('status',p_status));
end $$;
grant execute on function public.system_set_group_status(uuid,text) to authenticated;

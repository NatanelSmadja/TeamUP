-- TEAMUP V2.8: multi-group integrity, safe join requests and manager visibility

-- Every group owner must always have an active admin membership.
insert into public.group_members(group_id,user_id,role,status)
select g.id,g.owner_id,'admin','active'
from public.groups g
where g.owner_id is not null
on conflict(group_id,user_id) do update
set role='admin',status='active';

-- Prevent requesters from approving their own requests through a direct table update.
drop policy if exists "requester may cancel own request" on public.group_join_requests;

-- Keep select access limited to the requester or a manager of that exact group.
drop policy if exists "join requests visible to requester or group admin" on public.group_join_requests;
create policy "join requests visible to requester or group manager"
on public.group_join_requests for select to authenticated
using(
 user_id=(select auth.uid())
 or public.is_group_admin(group_id)
 or public.has_group_permission(group_id,'manage_members')
);

-- Requests are created only through the secure RPC below.
drop policy if exists "requester may insert join request" on public.group_join_requests;

create or replace function public.request_group_join(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_user uuid:=(select auth.uid());v_group public.groups;v_admin record;
begin
 if v_user is null then raise exception 'Not authenticated'; end if;
 select * into v_group from public.groups where id=p_group_id;
 if not found then raise exception 'הקבוצה לא נמצאה'; end if;
 if exists(select 1 from public.group_members where group_id=p_group_id and user_id=v_user and status='active') then
   delete from public.group_join_requests where group_id=p_group_id and user_id=v_user and status='pending';
   raise exception 'אתה כבר חבר בקבוצה';
 end if;
 insert into public.group_join_requests(group_id,user_id,status,reviewed_by,reviewed_at)
 values(p_group_id,v_user,'pending',null,null)
 on conflict(group_id,user_id) do update
 set status='pending',reviewed_by=null,reviewed_at=null,updated_at=now();
 for v_admin in
   select distinct gm.user_id
   from public.group_members gm
   where gm.group_id=p_group_id and gm.status='active'
     and (gm.role in ('admin','moderator') or exists(
       select 1 from public.member_permissions mp
       where mp.group_member_id=gm.id and mp.permission_key='manage_members'
     ))
 loop
   insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
   values(v_admin.user_id,'group_join_request','בקשת הצטרפות חדשה','שחקן חדש מבקש להצטרף ל־'||v_group.name,'group',p_group_id);
 end loop;
end
$$;
grant execute on function public.request_group_join(uuid) to authenticated;

create or replace function public.cancel_group_join_request(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
 update public.group_join_requests
 set status='cancelled',updated_at=now()
 where group_id=p_group_id and user_id=(select auth.uid()) and status='pending';
 if not found then raise exception 'לא נמצאה בקשה פתוחה לביטול'; end if;
end
$$;
grant execute on function public.cancel_group_join_request(uuid) to authenticated;

create or replace function public.list_group_join_requests(p_group_id uuid)
returns table(
 request_id uuid,user_id uuid,first_name text,last_name text,
 preferred_position text,preferred_positions text[],created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public
as $$
begin
 if not (public.is_group_admin(p_group_id) or public.has_group_permission(p_group_id,'manage_members')) then
   raise exception 'אין הרשאה לצפות בבקשות ההצטרפות';
 end if;
 return query
 select r.id,r.user_id,p.first_name,p.last_name,p.preferred_position,p.preferred_positions,r.created_at
 from public.group_join_requests r
 join public.profiles p on p.id=r.user_id
 where r.group_id=p_group_id and r.status='pending'
 order by r.created_at asc;
end
$$;
grant execute on function public.list_group_join_requests(uuid) to authenticated;

create or replace function public.review_group_join_request(p_request_id uuid,p_approve boolean)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_user uuid:=(select auth.uid());v_request public.group_join_requests;v_group_name text;
begin
 select * into v_request from public.group_join_requests where id=p_request_id for update;
 if not found then raise exception 'הבקשה לא נמצאה'; end if;
 if v_request.status<>'pending' then raise exception 'הבקשה כבר טופלה'; end if;
 if not (public.is_group_admin(v_request.group_id) or public.has_group_permission(v_request.group_id,'manage_members')) then
   raise exception 'אין הרשאה לאשר שחקנים בקבוצה הזאת';
 end if;
 select name into v_group_name from public.groups where id=v_request.group_id;
 if p_approve then
   insert into public.group_members(group_id,user_id,role,status)
   values(v_request.group_id,v_request.user_id,'player','active')
   on conflict(group_id,user_id) do update set status='active',role=case when public.group_members.role='admin' then 'admin'::public.member_role else 'player'::public.member_role end;
   update public.group_join_requests set status='approved',reviewed_by=v_user,reviewed_at=now(),updated_at=now() where id=p_request_id;
   insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
   values(v_request.user_id,'group_join_approved','בקשת ההצטרפות אושרה','הצטרפת ל־'||v_group_name,'group',v_request.group_id);
 else
   update public.group_join_requests set status='rejected',reviewed_by=v_user,reviewed_at=now(),updated_at=now() where id=p_request_id;
   insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
   values(v_request.user_id,'group_join_rejected','בקשת ההצטרפות נדחתה','הבקשה להצטרף ל־'||v_group_name||' לא אושרה','group',v_request.group_id);
 end if;
end
$$;
grant execute on function public.review_group_join_request(uuid,boolean) to authenticated;

create or replace function public.discover_groups()
returns table(
 group_id uuid,group_name text,description text,default_location text,owner_name text,
 member_count bigint,membership_status text,request_status text
)
language sql
stable
security definer
set search_path=public
as $$
 select g.id,g.name,g.description,g.default_location,
        trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')) as owner_name,
        (select count(*) from public.group_members gm where gm.group_id=g.id and gm.status='active') as member_count,
        case
          when g.owner_id=(select auth.uid()) then 'active'
          else (select gm.status::text from public.group_members gm where gm.group_id=g.id and gm.user_id=(select auth.uid()) order by gm.joined_at desc limit 1)
        end as membership_status,
        case
          when g.owner_id=(select auth.uid()) or exists(
            select 1 from public.group_members gm where gm.group_id=g.id and gm.user_id=(select auth.uid()) and gm.status='active'
          ) then null
          else (select r.status from public.group_join_requests r where r.group_id=g.id and r.user_id=(select auth.uid()) order by r.updated_at desc limit 1)
        end as request_status
 from public.groups g
 join public.profiles p on p.id=g.owner_id
 order by g.created_at desc;
$$;
grant execute on function public.discover_groups() to authenticated;

-- Clean impossible pending requests for users who are already active members.
update public.group_join_requests r
set status='approved',reviewed_at=coalesce(reviewed_at,now()),updated_at=now()
where r.status='pending'
  and exists(select 1 from public.group_members gm where gm.group_id=r.group_id and gm.user_id=r.user_id and gm.status='active');

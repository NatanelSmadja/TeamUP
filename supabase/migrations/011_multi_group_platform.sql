-- TEAMUP V2.7: multi-group platform, join requests and safe migration of existing users

-- Keep the current community and all of its data, only give it the requested name.
update public.groups
set name='כוכבי סטאר בול',
    description=coalesce(description,'קבוצת הכדורגל המקורית של TEAMUP')
where id=(select id from public.groups order by created_at asc limit 1);

create table if not exists public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id,user_id)
);

alter table public.group_join_requests enable row level security;

drop trigger if exists group_join_requests_updated on public.group_join_requests;
create trigger group_join_requests_updated before update on public.group_join_requests
for each row execute function public.set_updated_at();

-- Groups are discoverable, but their private content remains member-only.
drop policy if exists "groups visible to members" on public.groups;
drop policy if exists "groups visible to authenticated" on public.groups;
create policy "groups visible to authenticated" on public.groups
for select to authenticated using(true);

-- A user must be able to read their own memberships before selecting a group.
drop policy if exists "own memberships visible" on public.group_members;
create policy "own memberships visible" on public.group_members
for select to authenticated using(user_id=(select auth.uid()));

create policy "join requests visible to requester or group admin"
on public.group_join_requests for select to authenticated
using(user_id=(select auth.uid()) or public.is_group_admin(group_id));

create policy "requester may insert join request"
on public.group_join_requests for insert to authenticated
with check(user_id=(select auth.uid()));

create policy "requester may cancel own request"
on public.group_join_requests for update to authenticated
using(user_id=(select auth.uid()))
with check(user_id=(select auth.uid()));

-- Group administrators, not only the developer account, manage permissions in their own group.
drop policy if exists "permissions managed by system admin" on public.member_permissions;
drop policy if exists "permissions managed by group admin" on public.member_permissions;
create policy "permissions managed by group admin"
on public.member_permissions for all to authenticated
using(exists(select 1 from public.group_members gm where gm.id=group_member_id and public.is_group_admin(gm.group_id)))
with check(exists(select 1 from public.group_members gm where gm.id=group_member_id and public.is_group_admin(gm.group_id)));

-- New accounts receive only a profile. They choose or create a group from the group hub.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  primary_position text;
  positions text[];
begin
  primary_position := coalesce(new.raw_user_meta_data->>'preferred_position','utility');
  begin
    select coalesce(array_agg(value),array[primary_position]) into positions
    from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'preferred_positions',jsonb_build_array(primary_position))) t(value);
  exception when others then
    positions := array[primary_position];
  end;
  if positions is null or cardinality(positions)=0 then positions:=array[primary_position]; end if;

  insert into public.profiles(id,first_name,last_name,birth_date,preferred_position,preferred_positions,preferred_foot)
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name',''),
    coalesce(new.raw_user_meta_data->>'last_name',''),
    nullif(new.raw_user_meta_data->>'birth_date','')::date,
    primary_position,
    positions,
    coalesce(new.raw_user_meta_data->>'preferred_foot','right')::public.foot_type
  );
  return new;
end
$$;

create or replace function public.create_teamup_group(p_name text,p_description text default null,p_location text default null)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_user uuid:=(select auth.uid());v_group uuid;
begin
 if v_user is null then raise exception 'Not authenticated'; end if;
 if nullif(trim(p_name),'') is null then raise exception 'יש להזין שם קבוצה'; end if;
 insert into public.groups(name,description,owner_id,default_location)
 values(trim(p_name),nullif(trim(coalesce(p_description,'')),''),v_user,nullif(trim(coalesce(p_location,'')),''))
 returning id into v_group;
 insert into public.group_members(group_id,user_id,role,status) values(v_group,v_user,'admin','active');
 insert into public.activity_events(group_id,event_type,title,message,actor_user_id,entity_type,entity_id)
 values(v_group,'group_created','הקבוצה נפתחה','ברוכים הבאים ל־'||trim(p_name),v_user,'group',v_group);
 return v_group;
end
$$;
grant execute on function public.create_teamup_group(text,text,text) to authenticated;

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
 if exists(select 1 from public.group_members where group_id=p_group_id and user_id=v_user and status='active') then raise exception 'אתה כבר חבר בקבוצה'; end if;
 insert into public.group_join_requests(group_id,user_id,status,reviewed_by,reviewed_at)
 values(p_group_id,v_user,'pending',null,null)
 on conflict(group_id,user_id) do update set status='pending',reviewed_by=null,reviewed_at=null,updated_at=now();
 for v_admin in select user_id from public.group_members where group_id=p_group_id and status='active' and role='admin' loop
   insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
   values(v_admin.user_id,'group_join_request','בקשת הצטרפות חדשה','שחקן חדש מבקש להצטרף ל־'||v_group.name,'group',p_group_id);
 end loop;
end
$$;
grant execute on function public.request_group_join(uuid) to authenticated;

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
 if not exists(select 1 from public.group_members where group_id=v_request.group_id and user_id=v_user and status='active' and role='admin') then raise exception 'רק מנהל הקבוצה יכול לאשר שחקנים'; end if;
 select name into v_group_name from public.groups where id=v_request.group_id;
 if p_approve then
   insert into public.group_members(group_id,user_id,role,status)
   values(v_request.group_id,v_request.user_id,'player','active')
   on conflict(group_id,user_id) do update set status='active';
   update public.group_join_requests set status='approved',reviewed_by=v_user,reviewed_at=now() where id=p_request_id;
   insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
   values(v_request.user_id,'group_join_approved','בקשת ההצטרפות אושרה','הצטרפת ל־'||v_group_name,'group',v_request.group_id);
 else
   update public.group_join_requests set status='rejected',reviewed_by=v_user,reviewed_at=now() where id=p_request_id;
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
        (select gm.status::text from public.group_members gm where gm.group_id=g.id and gm.user_id=(select auth.uid()) limit 1) as membership_status,
        (select r.status from public.group_join_requests r where r.group_id=g.id and r.user_id=(select auth.uid()) limit 1) as request_status
 from public.groups g join public.profiles p on p.id=g.owner_id
 order by g.created_at desc;
$$;
grant execute on function public.discover_groups() to authenticated;

-- Realtime for join request counters and approval screens.
do $$ begin
 alter publication supabase_realtime add table public.group_join_requests;
exception when duplicate_object then null; end $$;

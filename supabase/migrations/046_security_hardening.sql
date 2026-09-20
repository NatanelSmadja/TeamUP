-- Close privilege-escalation and cross-group data access paths.

create schema if not exists private;
revoke all on schema private from public,anon,authenticated;

create table if not exists private.rpc_rate_limits (
  user_id uuid not null,
  action text not null,
  window_started_at timestamptz not null,
  attempts integer not null,
  primary key(user_id,action)
);
revoke all on private.rpc_rate_limits from public,anon,authenticated;

create or replace function private.consume_rate_limit(
  p_user_id uuid,
  p_action text,
  p_limit integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare v_attempts integer;
begin
  if p_user_id is null or p_limit<1 or p_window<=interval '0 seconds' then return false; end if;
  insert into private.rpc_rate_limits(user_id,action,window_started_at,attempts)
  values(p_user_id,p_action,clock_timestamp(),1)
  on conflict(user_id,action) do update set
    window_started_at=case
      when private.rpc_rate_limits.window_started_at+p_window<=clock_timestamp() then clock_timestamp()
      else private.rpc_rate_limits.window_started_at end,
    attempts=case
      when private.rpc_rate_limits.window_started_at+p_window<=clock_timestamp() then 1
      else private.rpc_rate_limits.attempts+1 end
  returning attempts into v_attempts;
  return v_attempts<=p_limit;
end;
$$;
revoke all on function private.consume_rate_limit(uuid,text,integer,interval) from public,anon,authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  new.updated_at=clock_timestamp();
  return new;
end;
$$;

-- Profiles: reads are limited to self, system admins, and active shared groups.
drop policy if exists "profiles visible to authenticated" on public.profiles;
create policy "profiles visible to self or shared group"
on public.profiles for select to authenticated
using (
  profiles.id=(select auth.uid())
  or public.is_system_admin()
  or exists(
    select 1
    from public.group_members mine
    join public.group_members target on target.group_id=mine.group_id
    where mine.user_id=(select auth.uid())
      and mine.status='active'
      and target.user_id=profiles.id
      and target.status='active'
  )
);

drop policy if exists "profile owner update" on public.profiles;
revoke insert,update,delete on public.profiles from anon,authenticated;

create or replace function public.update_own_profile(
  p_first_name text,
  p_last_name text,
  p_birth_date date,
  p_preferred_positions text[],
  p_preferred_foot text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=(select auth.uid());
  v_first text:=regexp_replace(trim(coalesce(p_first_name,'')),'[[:space:]]+',' ','g');
  v_last text:=regexp_replace(trim(coalesce(p_last_name,'')),'[[:space:]]+',' ','g');
  v_positions text[];
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(v_first)<1 or char_length(v_first)>60 then raise exception 'שם פרטי אינו תקין'; end if;
  if char_length(v_last)<1 or char_length(v_last)>60 then raise exception 'שם משפחה אינו תקין'; end if;
  if p_birth_date is not null and (p_birth_date>current_date or p_birth_date<current_date-interval '120 years') then
    raise exception 'תאריך הלידה אינו תקין';
  end if;
  if p_preferred_foot is not null and p_preferred_foot not in ('right','left','both') then
    raise exception 'הרגל המועדפת אינה תקינה';
  end if;
  select array_agg(value order by first_ordinality) into v_positions
  from (
    select value,min(ordinality) first_ordinality
    from unnest(coalesce(p_preferred_positions,array[]::text[])) with ordinality as p(value,ordinality)
    where value in ('goalkeeper','defender','midfielder','winger','striker','utility')
    group by value
  ) valid;
  if coalesce(cardinality(v_positions),0)<1 or cardinality(v_positions)>6 then
    raise exception 'יש לבחור לפחות עמדה תקינה אחת';
  end if;

  update public.profiles set
    first_name=v_first,
    last_name=v_last,
    birth_date=p_birth_date,
    preferred_positions=v_positions,
    preferred_position=v_positions[1],
    preferred_foot=p_preferred_foot::public.foot_type
  where id=v_user;
  if not found then raise exception 'הפרופיל לא נמצא'; end if;
end;
$$;
revoke all on function public.update_own_profile(text,text,date,text[],text) from public,anon;
grant execute on function public.update_own_profile(text,text,date,text[],text) to authenticated;

-- Correct the two policies whose unqualified column names were shadowed.
drop policy if exists "group members read activity" on public.activity_events;
create policy "group members read activity"
on public.activity_events for select to authenticated
using (
  exists(
    select 1 from public.group_members gm
    where gm.group_id=activity_events.group_id
      and gm.user_id=(select auth.uid())
      and gm.status='active'
  )
);

drop policy if exists "groups discoverable or member visible" on public.groups;
create policy "groups discoverable or member visible"
on public.groups for select to authenticated
using (
  (groups.lifecycle_status='active' and groups.visibility='public')
  or groups.owner_id=(select auth.uid())
  or exists(
    select 1 from public.group_members gm
    where gm.group_id=groups.id
      and gm.user_id=(select auth.uid())
      and gm.status='active'
  )
  or public.is_system_admin()
);

drop policy if exists "groups admin update" on public.groups;
revoke insert,update,delete on public.groups from anon,authenticated;

create or replace function public.update_group_settings(
  p_group_id uuid,
  p_name text,
  p_description text,
  p_default_location text,
  p_visibility text,
  p_join_mode text,
  p_theme_color text,
  p_poll_miss_tracking_enabled boolean,
  p_poll_miss_alert_threshold integer
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_group public.groups;
  v_name text:=regexp_replace(trim(coalesce(p_name,'')),'[[:space:]]+',' ','g');
  v_new jsonb;
begin
  select * into v_group from public.groups where id=p_group_id for update;
  if not found then raise exception 'הקבוצה לא נמצאה'; end if;
  if not (public.is_group_admin(p_group_id) or public.is_system_admin()) then raise exception 'אין הרשאה'; end if;
  if char_length(v_name)<2 or char_length(v_name)>80 then raise exception 'שם הקבוצה אינו תקין'; end if;
  if p_visibility not in ('public','private') then raise exception 'סוג החשיפה אינו תקין'; end if;
  if p_join_mode not in ('open','approval_required','invite_only') then raise exception 'מצב ההצטרפות אינו תקין'; end if;
  if p_theme_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'צבע הקבוצה אינו תקין'; end if;
  if p_poll_miss_alert_threshold<1 or p_poll_miss_alert_threshold>20 then raise exception 'סף ההתראות אינו תקין'; end if;

  update public.groups set
    name=v_name,
    description=nullif(trim(coalesce(p_description,'')),''),
    default_location=nullif(trim(coalesce(p_default_location,'')),''),
    visibility=p_visibility,
    join_mode=p_join_mode,
    theme_color=lower(p_theme_color),
    poll_miss_tracking_enabled=coalesce(p_poll_miss_tracking_enabled,false),
    poll_miss_alert_threshold=p_poll_miss_alert_threshold
  where id=p_group_id
  returning to_jsonb(public.groups.*) into v_new;

  insert into public.audit_logs(group_id,performed_by,action,entity_type,entity_id,old_data,new_data)
  values(p_group_id,(select auth.uid()),'group.updated','group',p_group_id,to_jsonb(v_group),v_new);
end;
$$;
revoke all on function public.update_group_settings(uuid,text,text,text,text,text,text,boolean,integer) from public,anon;
grant execute on function public.update_group_settings(uuid,text,text,text,text,text,text,boolean,integer) to authenticated;

-- Matches are created and changed only through narrowly scoped RPCs.
drop policy if exists "matches permitted insert" on public.matches;
drop policy if exists "matches permitted update" on public.matches;
revoke insert,update,delete on public.matches from anon,authenticated;

create or replace function public.create_match_secure(
  p_group_id uuid,
  p_title text,
  p_match_date date,
  p_start_time time,
  p_end_time time,
  p_location text,
  p_capacity integer,
  p_team_count integer,
  p_team_size integer,
  p_price_per_player numeric
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=(select auth.uid());
  v_id uuid;
  v_title text:=regexp_replace(trim(coalesce(p_title,'')),'[[:space:]]+',' ','g');
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.has_group_permission(p_group_id,'create_match') then raise exception 'אין הרשאה ליצור משחק'; end if;
  if char_length(v_title)<2 or char_length(v_title)>80 then raise exception 'שם המשחק אינו תקין'; end if;
  if p_match_date is null or p_start_time is null then raise exception 'תאריך ושעת המשחק נדרשים'; end if;
  if p_team_count<2 or p_team_count>4 then raise exception 'מספר הקבוצות צריך להיות בין 2 ל־4'; end if;
  if p_team_size<1 or p_team_size>50 then raise exception 'גודל הקבוצה אינו תקין'; end if;
  if p_capacity<p_team_count or p_capacity>200 then raise exception 'מספר המשתתפים אינו תקין'; end if;
  if p_price_per_player<0 or p_price_per_player>100000 then raise exception 'המחיר אינו תקין'; end if;

  insert into public.matches(
    group_id,created_by,title,match_date,start_time,end_time,location,
    capacity,team_count,team_size,price_per_player,status
  ) values (
    p_group_id,v_user,v_title,p_match_date,p_start_time,p_end_time,
    nullif(trim(coalesce(p_location,'')),''),p_capacity,p_team_count,p_team_size,
    p_price_per_player,'registration_open'
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_match_secure(uuid,text,date,time,time,text,integer,integer,integer,numeric) from public,anon;
grant execute on function public.create_match_secure(uuid,text,date,time,time,text,integer,integer,integer,numeric) to authenticated;

-- Invalid invite attempts return null so the rate-limit counter is committed.
create or replace function public.join_group_by_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_group public.groups;
  v_user uuid:=(select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.consume_rate_limit(v_user,'join_group_by_invite',10,interval '15 minutes') then return null; end if;
  select * into v_group
  from public.groups
  where upper(invite_code)=upper(trim(p_code)) and lifecycle_status='active';
  if not found then return null; end if;
  insert into public.group_members(group_id,user_id,role,status)
  values(v_group.id,v_user,'player','active')
  on conflict(group_id,user_id) do update set
    status='active',
    role=case when public.group_members.role='admin' then 'admin'::public.member_role else 'player'::public.member_role end;
  insert into public.group_join_requests(group_id,user_id,status,reviewed_by,reviewed_at)
  values(v_group.id,v_user,'approved',v_group.owner_id,clock_timestamp())
  on conflict(group_id,user_id) do update set
    status='approved',reviewed_by=v_group.owner_id,reviewed_at=clock_timestamp(),updated_at=clock_timestamp();
  return v_group.id;
end;
$$;

-- Anonymous users do not need direct access to application tables or privileged functions.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public,anon',r.signature);
  end loop;

  for r in
    select distinct p.oid::regprocedure as signature
    from pg_trigger t
    join pg_proc p on p.oid=t.tgfoid
    join pg_namespace n on n.oid=p.pronamespace
    where not t.tgisinternal and n.nspname='public'
  loop
    execute format('revoke execute on function %s from public,anon,authenticated',r.signature);
  end loop;
end;
$$;

revoke execute on function public.notify_group(uuid,text,text,text,text,uuid) from authenticated;
revoke execute on function public.log_activity(uuid,uuid,text,text,text,text,uuid) from authenticated;
revoke execute on function public.log_group_audit(uuid,text,text,uuid,jsonb,jsonb) from authenticated;

grant execute on function public.join_group_by_invite(text) to authenticated;
grant execute on function public.match_goal_reporting_open(uuid) to authenticated;

revoke insert,update,delete on public.group_members from authenticated;
revoke insert,update,delete on public.member_permissions from authenticated;
revoke insert,update,delete on public.activity_events from authenticated;
revoke insert,update,delete on public.audit_logs from authenticated;
revoke insert,delete,update on public.notifications from authenticated;
grant update(is_read) on public.notifications to authenticated;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

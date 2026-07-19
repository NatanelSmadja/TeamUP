-- GolTime Squad initial schema
create extension if not exists pgcrypto;

create type public.member_role as enum ('player','moderator','admin');
create type public.member_status as enum ('active','inactive','suspended','invited');
create type public.match_status as enum ('draft','registration_open','registration_closed','teams_published','completed','cancelled');
create type public.registration_response as enum ('attending','unavailable','no_response');
create type public.registration_status as enum ('confirmed','waitlisted','cancelled','removed');
create type public.foot_type as enum ('right','left','both');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  birth_date date,
  preferred_position text check (preferred_position in ('goalkeeper','defender','midfielder','winger','striker','utility')),
  secondary_position text check (secondary_position is null or secondary_position in ('goalkeeper','defender','midfielder','winger','striker','utility')),
  preferred_foot public.foot_type,
  avatar_url text,
  base_rating numeric(4,2) not null default 3.00 check (base_rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  owner_id uuid not null references public.profiles(id),
  default_capacity int not null default 15 check (default_capacity > 0),
  default_team_size int not null default 5 check (default_team_size > 0),
  default_team_count int not null default 3 check (default_team_count > 1),
  default_location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'player',
  status public.member_status not null default 'active',
  consecutive_no_responses int not null default 0,
  joined_at timestamptz not null default now(),
  unique(group_id,user_id)
);

create table public.permissions (
  key text primary key,
  label text not null
);
insert into public.permissions(key,label) values
('create_match','פתיחת משחק'),('edit_match','עריכת משחק'),('close_registration','סגירת הרשמה'),
('manage_registrations','ניהול נרשמים'),('generate_teams','יצירת קבוצות'),('edit_teams','עריכת קבוצות'),
('publish_teams','פרסום קבוצות'),('enter_results','הזנת תוצאות'),('open_ratings','פתיחת דירוגים'),
('manage_members','ניהול חברים'),('manage_permissions','ניהול הרשאות'),('view_admin_alerts','צפייה בהתראות מנהל');

create table public.member_permissions (
  id uuid primary key default gen_random_uuid(),
  group_member_id uuid not null references public.group_members(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(group_member_id,permission_key)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  title text not null default 'משחק גול טיים',
  match_date date not null,
  start_time time not null,
  end_time time,
  location text,
  team_size int not null default 5 check(team_size > 0),
  team_count int not null default 3 check(team_count > 1),
  capacity int not null default 15 check(capacity > 0),
  price_per_player numeric(8,2) not null default 0 check(price_per_player >= 0),
  registration_deadline timestamptz,
  status public.match_status not null default 'draft',
  auto_promote_waitlist boolean not null default true,
  ratings_open boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.match_registrations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response public.registration_response not null default 'no_response',
  registration_status public.registration_status not null default 'cancelled',
  queue_position int,
  registered_at timestamptz not null default now(),
  promoted_at timestamptz,
  cancelled_at timestamptz,
  unique(match_id,user_id)
);
create index match_registrations_queue_idx on public.match_registrations(match_id,registration_status,registered_at);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  name text not null,
  team_number int not null,
  generation_version int not null default 1,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  unique(match_id,generation_version,team_number)
);

create table public.team_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_position text,
  is_goalkeeper boolean not null default false,
  unique(team_id,user_id)
);

create table public.player_ratings (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  rater_user_id uuid not null references public.profiles(id) on delete cascade,
  rated_user_id uuid not null references public.profiles(id) on delete cascade,
  overall_rating int not null check(overall_rating between 1 and 5),
  teamwork_rating int check(teamwork_rating between 1 and 5),
  attack_rating int check(attack_rating between 1 and 5),
  defense_rating int check(defense_rating between 1 and 5),
  effort_rating int check(effort_rating between 1 and 5),
  sportsmanship_rating int check(sportsmanship_rating between 1 and 5),
  created_at timestamptz not null default now(),
  check(rater_user_id <> rated_user_id),
  unique(match_id,rater_user_id,rated_user_id)
);

create table public.mvp_votes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  voter_user_id uuid not null references public.profiles(id) on delete cascade,
  voted_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check(voter_user_id <> voted_user_id),
  unique(match_id,voter_user_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  entity_type text,
  entity_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.admin_alerts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  type text not null,
  message text not null,
  is_resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  group_id uuid references public.groups(id) on delete cascade,
  performed_by uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger groups_updated before update on public.groups for each row execute function public.set_updated_at();
create trigger matches_updated before update on public.matches for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare new_group uuid; first_user boolean;
begin
  insert into public.profiles(id,first_name,last_name,birth_date,preferred_position,preferred_foot)
  values(new.id,coalesce(new.raw_user_meta_data->>'first_name',''),coalesce(new.raw_user_meta_data->>'last_name',''),nullif(new.raw_user_meta_data->>'birth_date','')::date,coalesce(new.raw_user_meta_data->>'preferred_position','utility'),coalesce(new.raw_user_meta_data->>'preferred_foot','right')::public.foot_type);
  select not exists(select 1 from public.groups) into first_user;
  if first_user then
    insert into public.groups(name,description,owner_id,default_location) values('הקבוצה שלנו','קבוצת גול טיים',new.id,'Gol Time') returning id into new_group;
    insert into public.group_members(group_id,user_id,role) values(new_group,new.id,'admin');
  else
    select id into new_group from public.groups order by created_at limit 1;
    insert into public.group_members(group_id,user_id,role) values(new_group,new.id,'player');
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_group_member(p_group uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.group_members where group_id=p_group and user_id=(select auth.uid()) and status='active');
$$;
create or replace function public.is_group_admin(p_group uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.group_members where group_id=p_group and user_id=(select auth.uid()) and status='active' and role in ('admin','moderator'));
$$;

create or replace function public.respond_to_match(p_match_id uuid,p_response public.registration_response) returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=(select auth.uid());v_match public.matches;v_count int;v_status public.registration_status;v_next public.match_registrations;
begin
 if v_user is null then raise exception 'Not authenticated'; end if;
 select * into v_match from public.matches where id=p_match_id for update;
 if not found or not public.is_group_member(v_match.group_id) then raise exception 'Not allowed'; end if;
 if v_match.status <> 'registration_open' then raise exception 'Registration is closed'; end if;
 if p_response='attending' then
   select count(*) into v_count from public.match_registrations where match_id=p_match_id and registration_status='confirmed';
   v_status:=case when v_count < v_match.capacity then 'confirmed' else 'waitlisted' end;
   insert into public.match_registrations(match_id,user_id,response,registration_status,queue_position,registered_at,cancelled_at)
   values(p_match_id,v_user,'attending',v_status,case when v_status='waitlisted' then v_count-v_match.capacity+1 else null end,now(),null)
   on conflict(match_id,user_id) do update set response='attending',registration_status=v_status,queue_position=excluded.queue_position,registered_at=now(),cancelled_at=null;
 else
   update public.match_registrations set response='unavailable',registration_status='cancelled',cancelled_at=now(),queue_position=null where match_id=p_match_id and user_id=v_user;
   if not found then insert into public.match_registrations(match_id,user_id,response,registration_status,cancelled_at) values(p_match_id,v_user,'unavailable','cancelled',now()); end if;
   if v_match.auto_promote_waitlist then
     select * into v_next from public.match_registrations where match_id=p_match_id and registration_status='waitlisted' order by registered_at for update skip locked limit 1;
     if found then
       update public.match_registrations set registration_status='confirmed',promoted_at=now(),queue_position=null where id=v_next.id;
       insert into public.notifications(user_id,type,title,message,entity_type,entity_id) values(v_next.user_id,'waitlist_promoted','נכנסת למשחק','התפנה מקום ונכנסת אוטומטית לרשימה הראשית','match',p_match_id);
     end if;
   end if;
 end if;
 with ranked as (select id,row_number() over(order by registered_at) rn from public.match_registrations where match_id=p_match_id and registration_status='waitlisted') update public.match_registrations mr set queue_position=ranked.rn from ranked where mr.id=ranked.id;
end $$;
grant execute on function public.respond_to_match(uuid,public.registration_response) to authenticated;

create or replace function public.generate_balanced_teams(p_match_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v_match public.matches;v_version int;v_team_ids uuid[];rec record;i int:=0;idx int;
begin
 select * into v_match from public.matches where id=p_match_id;
 if not found or not public.is_group_admin(v_match.group_id) then raise exception 'Not allowed'; end if;
 select coalesce(max(generation_version),0)+1 into v_version from public.teams where match_id=p_match_id;
 v_team_ids:=array[]::uuid[];
 for idx in 1..v_match.team_count loop
   insert into public.teams(match_id,name,team_number,generation_version) values(p_match_id,'קבוצה '||idx,idx,v_version) returning id into rec;
   v_team_ids:=array_append(v_team_ids,rec.id);
 end loop;
 for rec in select mr.user_id,p.base_rating,p.preferred_position from public.match_registrations mr join public.profiles p on p.id=mr.user_id where mr.match_id=p_match_id and mr.registration_status='confirmed' order by (p.preferred_position='goalkeeper') desc,p.base_rating desc,random() loop
   idx:=(i % v_match.team_count)+1;
   insert into public.team_players(team_id,user_id,assigned_position,is_goalkeeper) values(v_team_ids[idx],rec.user_id,rec.preferred_position,rec.preferred_position='goalkeeper');
   i:=i+1;
 end loop;
 update public.matches set status='teams_published' where id=p_match_id;
 update public.teams set is_published=true where match_id=p_match_id and generation_version=v_version;
end $$;
grant execute on function public.generate_balanced_teams(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.member_permissions enable row level security;
alter table public.matches enable row level security;
alter table public.match_registrations enable row level security;
alter table public.teams enable row level security;
alter table public.team_players enable row level security;
alter table public.player_ratings enable row level security;
alter table public.mvp_votes enable row level security;
alter table public.notifications enable row level security;
alter table public.admin_alerts enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles visible to authenticated" on public.profiles for select to authenticated using(true);
create policy "profile owner update" on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy "groups visible to members" on public.groups for select to authenticated using(public.is_group_member(id));
create policy "groups admin update" on public.groups for update to authenticated using(public.is_group_admin(id));
create policy "members visible in group" on public.group_members for select to authenticated using(public.is_group_member(group_id));
create policy "members managed by admins" on public.group_members for all to authenticated using(public.is_group_admin(group_id)) with check(public.is_group_admin(group_id));
create policy "permissions visible" on public.member_permissions for select to authenticated using(exists(select 1 from public.group_members gm where gm.id=group_member_id and public.is_group_member(gm.group_id)));
create policy "permissions managed" on public.member_permissions for all to authenticated using(exists(select 1 from public.group_members gm where gm.id=group_member_id and public.is_group_admin(gm.group_id))) with check(exists(select 1 from public.group_members gm where gm.id=group_member_id and public.is_group_admin(gm.group_id)));
create policy "matches visible" on public.matches for select to authenticated using(public.is_group_member(group_id));
create policy "matches admin insert" on public.matches for insert to authenticated with check(public.is_group_admin(group_id) and created_by=(select auth.uid()));
create policy "matches admin update" on public.matches for update to authenticated using(public.is_group_admin(group_id));
create policy "registrations visible" on public.match_registrations for select to authenticated using(exists(select 1 from public.matches m where m.id=match_id and public.is_group_member(m.group_id)));
create policy "teams visible" on public.teams for select to authenticated using(exists(select 1 from public.matches m where m.id=match_id and public.is_group_member(m.group_id)));
create policy "team players visible" on public.team_players for select to authenticated using(exists(select 1 from public.teams t join public.matches m on m.id=t.match_id where t.id=team_id and public.is_group_member(m.group_id)));
create policy "ratings visible after match" on public.player_ratings for select to authenticated using(exists(select 1 from public.matches m where m.id=match_id and public.is_group_member(m.group_id)));
create policy "ratings insert participants" on public.player_ratings for insert to authenticated with check(rater_user_id=(select auth.uid()) and exists(select 1 from public.matches m join public.match_registrations mr on mr.match_id=m.id where m.id=match_id and m.ratings_open and mr.user_id=(select auth.uid()) and mr.registration_status='confirmed'));
create policy "mvp votes visible" on public.mvp_votes for select to authenticated using(exists(select 1 from public.matches m where m.id=match_id and public.is_group_member(m.group_id)));
create policy "mvp vote insert" on public.mvp_votes for insert to authenticated with check(voter_user_id=(select auth.uid()) and exists(select 1 from public.matches m join public.match_registrations mr on mr.match_id=m.id where m.id=match_id and m.ratings_open and mr.user_id=(select auth.uid()) and mr.registration_status='confirmed'));
create policy "own notifications" on public.notifications for select to authenticated using(user_id=(select auth.uid()));
create policy "own notifications update" on public.notifications for update to authenticated using(user_id=(select auth.uid()));
create policy "admin alerts" on public.admin_alerts for select to authenticated using(public.is_group_admin(group_id));
create policy "audit admins" on public.audit_logs for select to authenticated using(group_id is not null and public.is_group_admin(group_id));

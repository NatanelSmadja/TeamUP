-- TEAMUP V2: activity feed, match results, achievements, team colors and manual balancing
alter table public.teams add column if not exists color_key text not null default 'blue';

create table if not exists public.match_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  home_team_id uuid not null references public.teams(id) on delete cascade,
  away_team_id uuid not null references public.teams(id) on delete cascade,
  home_score int not null default 0 check(home_score >= 0),
  away_score int not null default 0 check(away_score >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(match_id,home_team_id,away_team_id)
);

create table if not exists public.activity_events (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  title text not null,
  message text,
  entity_type text,
  entity_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists activity_events_group_created_idx on public.activity_events(group_id,created_at desc);

alter table public.match_results enable row level security;
alter table public.activity_events enable row level security;

drop policy if exists "group members read results" on public.match_results;
create policy "group members read results" on public.match_results for select to authenticated using (
 exists(select 1 from public.matches m join public.group_members gm on gm.group_id=m.group_id where m.id=match_id and gm.user_id=(select auth.uid()) and gm.status='active')
);
drop policy if exists "managers write results" on public.match_results;
create policy "managers write results" on public.match_results for all to authenticated using (
 exists(select 1 from public.matches m where m.id=match_id and public.has_group_permission(m.group_id,'enter_results'))
) with check (
 exists(select 1 from public.matches m where m.id=match_id and public.has_group_permission(m.group_id,'enter_results'))
);

drop policy if exists "group members read activity" on public.activity_events;
create policy "group members read activity" on public.activity_events for select to authenticated using (
 exists(select 1 from public.group_members gm where gm.group_id=group_id and gm.user_id=(select auth.uid()) and gm.status='active')
);

do $$ begin alter publication supabase_realtime add table public.activity_events; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.match_results; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.player_ratings; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.mvp_votes; exception when duplicate_object then null; end $$;

create or replace function public.log_activity(p_group uuid,p_actor uuid,p_type text,p_title text,p_message text default null,p_entity_type text default null,p_entity_id uuid default null)
returns void language sql security definer set search_path=public as $$
 insert into public.activity_events(group_id,actor_id,event_type,title,message,entity_type,entity_id)
 values(p_group,p_actor,p_type,p_title,p_message,p_entity_type,p_entity_id);
$$;

create or replace function public.activity_registration() returns trigger language plpgsql security definer set search_path=public as $$
declare g uuid; n text;
begin
 select group_id into g from public.matches where id=new.match_id;
 select trim(first_name||' '||last_name) into n from public.profiles where id=new.user_id;
 if new.registration_status='confirmed' and (tg_op='INSERT' or old.registration_status is distinct from new.registration_status) then
  perform public.log_activity(g,new.user_id,'registration',n||' נרשם למשחק','הרשימת המשתתפים עודכנה','match',new.match_id);
 elsif new.response='unavailable' and (tg_op='INSERT' or old.response is distinct from new.response) then
  perform public.log_activity(g,new.user_id,'unavailable',n||' לא זמין למשחק',null,'match',new.match_id);
 end if;
 return new;
end $$;
drop trigger if exists activity_registration_trigger on public.match_registrations;
create trigger activity_registration_trigger after insert or update on public.match_registrations for each row execute function public.activity_registration();

create or replace function public.activity_match() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then perform public.log_activity(new.group_id,new.created_by,'match_opened','נפתחה הרשמה חדשה',new.title,'match',new.id);
 elsif new.status='teams_published' and old.status is distinct from new.status then perform public.log_activity(new.group_id,new.created_by,'teams','הקבוצות פורסמו',new.title,'match',new.id);
 elsif new.ratings_open=true and coalesce(old.ratings_open,false)=false then perform public.log_activity(new.group_id,new.created_by,'ratings','הדירוגים נפתחו',new.title,'rating',new.id);
 end if; return new;
end $$;
drop trigger if exists activity_match_trigger on public.matches;
create trigger activity_match_trigger after insert or update on public.matches for each row execute function public.activity_match();

create or replace function public.move_team_player(p_match_id uuid,p_user_id uuid,p_target_team_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare g uuid; source_id uuid;
begin
 select group_id into g from public.matches where id=p_match_id;
 if not public.has_group_permission(g,'edit_teams') and not public.has_group_permission(g,'generate_teams') then raise exception 'אין הרשאה לעריכת קבוצות'; end if;
 if not exists(select 1 from public.teams where id=p_target_team_id and match_id=p_match_id) then raise exception 'קבוצת היעד אינה שייכת למשחק'; end if;
 select tp.id into source_id from public.team_players tp join public.teams t on t.id=tp.team_id where t.match_id=p_match_id and tp.user_id=p_user_id order by t.generation_version desc limit 1;
 if source_id is null then raise exception 'השחקן לא נמצא בקבוצות'; end if;
 update public.team_players set team_id=p_target_team_id where id=source_id;
end $$;
grant execute on function public.move_team_player(uuid,uuid,uuid) to authenticated;

create or replace function public.generate_balanced_teams(p_match_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v_match public.matches;v_version int;v_team_ids uuid[];rec record;i int:=0;idx int;v_count int;v_team_count int;colors text[]:=array['red','blue','yellow','green']; names text[]:=array['האדומים','הכחולים','הצהובים','הירוקים'];
begin
 select * into v_match from public.matches where id=p_match_id;
 if not found or not public.has_group_permission(v_match.group_id,'generate_teams') then raise exception 'אין הרשאה';end if;
 if v_match.status<>'registration_closed' then raise exception 'אפשר לערבב קבוצות רק אחרי סגירת ההרשמה';end if;
 select count(*) into v_count from public.match_registrations where match_id=p_match_id and registration_status='confirmed';
 if v_count<4 then raise exception 'צריך לפחות 4 שחקנים לחלוקה';end if;
 v_team_count:=greatest(2,least(v_match.team_count,round(v_count::numeric/greatest(v_match.team_size,1))::int));
 select coalesce(max(generation_version),0)+1 into v_version from public.teams where match_id=p_match_id;
 v_team_ids:=array[]::uuid[];
 for idx in 1..v_team_count loop
  insert into public.teams(match_id,name,team_number,generation_version,color_key) values(p_match_id,names[idx],idx,v_version,colors[idx]) returning id into rec;
  v_team_ids:=array_append(v_team_ids,rec.id);
 end loop;
 for rec in
  select mr.user_id,coalesce(avg(pr.overall_rating),p.base_rating) rating,p.preferred_position
  from public.match_registrations mr join public.profiles p on p.id=mr.user_id
  left join public.player_ratings pr on pr.rated_user_id=mr.user_id
  where mr.match_id=p_match_id and mr.registration_status='confirmed'
  group by mr.user_id,p.base_rating,p.preferred_position
  order by (p.preferred_position='goalkeeper') desc, rating desc, random()
 loop
  idx:=case when (i / v_team_count)::int % 2=0 then (i % v_team_count)+1 else v_team_count-(i % v_team_count) end;
  insert into public.team_players(team_id,user_id,assigned_position,is_goalkeeper) values(v_team_ids[idx],rec.user_id,rec.preferred_position,rec.preferred_position='goalkeeper');
  i:=i+1;
 end loop;
 update public.matches set status='teams_published',team_count=v_team_count where id=p_match_id;
 update public.teams set is_published=true where match_id=p_match_id and generation_version=v_version;
end $$;
grant execute on function public.generate_balanced_teams(uuid) to authenticated;

-- Goal events are the single source of truth for match, monthly and all-time scoring.

do $$ begin
 create type public.goal_event_status as enum ('pending','approved','rejected','cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.goal_events (
 id uuid primary key default gen_random_uuid(),
 match_id uuid not null references public.matches(id) on delete cascade,
 scorer_user_id uuid not null references public.profiles(id) on delete restrict,
 team_id uuid references public.teams(id) on delete set null,
 reported_by uuid not null references public.profiles(id) on delete restrict,
 reviewed_by uuid references public.profiles(id) on delete set null,
 status public.goal_event_status not null default 'pending',
 client_request_id uuid not null,
 occurred_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 cancelled_at timestamptz,
 cancellation_reason text,
 constraint goal_events_request_unique unique(reported_by,client_request_id),
 constraint goal_events_review_state check (
  (status='pending' and reviewed_at is null)
  or (status in ('approved','rejected') and reviewed_at is not null)
  or status='cancelled'
 )
);

create index if not exists goal_events_match_status_idx on public.goal_events(match_id,status,created_at desc);
create index if not exists goal_events_scorer_status_time_idx on public.goal_events(scorer_user_id,status,occurred_at desc);
create index if not exists goal_events_team_status_idx on public.goal_events(team_id,status) where team_id is not null;

create or replace function public.is_match_result_manager(p_match_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from public.matches m
  where m.id=p_match_id
   and (m.created_by=(select auth.uid()) or public.has_group_permission(m.group_id,'enter_results'))
 );
$$;

create or replace function public.match_goal_reporting_open(p_match_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((
  select m.status not in ('completed','cancelled')
   and (clock_timestamp() at time zone 'Asia/Jerusalem') >= (m.match_date+m.start_time)
   and (clock_timestamp() at time zone 'Asia/Jerusalem') <= case
    when m.end_time is null then m.match_date+m.start_time+interval '2 hours'
    when m.end_time<m.start_time then m.match_date+m.end_time+interval '1 day'
    else m.match_date+m.end_time end
  from public.matches m where m.id=p_match_id
 ),false);
$$;

alter table public.goal_events enable row level security;
drop policy if exists "goal events visible to group" on public.goal_events;
create policy "goal events visible to group" on public.goal_events for select to authenticated using(
 exists(
  select 1 from public.matches m where m.id=goal_events.match_id
   and public.is_group_member(m.group_id)
   and (goal_events.status='approved' or goal_events.reported_by=(select auth.uid()) or public.is_match_result_manager(m.id))
 )
);
revoke insert,update,delete on public.goal_events from anon,authenticated;
grant select on public.goal_events to authenticated;

create or replace function public.report_match_goal(p_match_id uuid,p_scorer_user_id uuid,p_client_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=(select auth.uid());v_id uuid;v_team uuid;
begin
 if v_user is null then raise exception 'יש להתחבר כדי לדווח על שער'; end if;
 if p_client_request_id is null then raise exception 'מזהה הבקשה חסר'; end if;
 if not public.match_goal_reporting_open(p_match_id) then raise exception 'ניתן לדווח על שער רק בזמן שהמשחק פעיל'; end if;
 if not exists(select 1 from public.match_registrations where match_id=p_match_id and user_id=v_user and registration_status='confirmed' and attended=true) then
  raise exception 'רק שחקן שמשתתף במשחק יכול לדווח על שער';
 end if;
 if not exists(select 1 from public.match_registrations where match_id=p_match_id and user_id=p_scorer_user_id and registration_status='confirmed' and attended=true) then
  raise exception 'ניתן לדווח רק על שחקן שמשתתף במשחק';
 end if;
 select tp.team_id into v_team from public.team_players tp join public.teams t on t.id=tp.team_id
 where t.match_id=p_match_id and t.is_published=true and tp.user_id=p_scorer_user_id
 order by t.generation_version desc limit 1;
 insert into public.goal_events(match_id,scorer_user_id,team_id,reported_by,status,client_request_id)
 values(p_match_id,p_scorer_user_id,v_team,v_user,'pending',p_client_request_id)
 on conflict(reported_by,client_request_id) do nothing returning id into v_id;
 if v_id is null then
  select id into v_id from public.goal_events where reported_by=v_user and client_request_id=p_client_request_id;
 end if;
 return v_id;
end $$;
grant execute on function public.report_match_goal(uuid,uuid,uuid) to authenticated;

create or replace function public.add_approved_match_goal(p_match_id uuid,p_scorer_user_id uuid,p_client_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=(select auth.uid());m public.matches;v_id uuid;v_team uuid;v_local_now timestamp;v_end timestamp;v_occurred timestamptz;
begin
 if v_user is null then raise exception 'יש להתחבר כדי להוסיף שער'; end if;
 if p_client_request_id is null then raise exception 'מזהה הבקשה חסר'; end if;
 select * into m from public.matches where id=p_match_id;
 if not found then raise exception 'המשחק לא נמצא'; end if;
 if not public.is_match_result_manager(p_match_id) then raise exception 'אין הרשאה להוסיף שער ישירות'; end if;
 v_local_now:=clock_timestamp() at time zone 'Asia/Jerusalem';
 if v_local_now<(m.match_date+m.start_time) then raise exception 'לא ניתן להוסיף שער לפני תחילת המשחק'; end if;
 if m.status='cancelled' then raise exception 'לא ניתן להוסיף שער למשחק שבוטל'; end if;
 if not exists(select 1 from public.match_registrations where match_id=p_match_id and user_id=p_scorer_user_id and registration_status='confirmed' and attended=true) then
  raise exception 'ניתן להוסיף שער רק לשחקן שהשתתף במשחק';
 end if;
 select tp.team_id into v_team from public.team_players tp join public.teams t on t.id=tp.team_id
 where t.match_id=p_match_id and t.is_published=true and tp.user_id=p_scorer_user_id
 order by t.generation_version desc limit 1;
 v_end:=case when m.end_time is null then m.match_date+m.start_time+interval '2 hours' when m.end_time<m.start_time then m.match_date+m.end_time+interval '1 day' else m.match_date+m.end_time end;
 v_occurred:=case when v_local_now>v_end then v_end at time zone 'Asia/Jerusalem' else now() end;
 insert into public.goal_events(match_id,scorer_user_id,team_id,reported_by,reviewed_by,status,client_request_id,occurred_at,reviewed_at)
 values(p_match_id,p_scorer_user_id,v_team,v_user,v_user,'approved',p_client_request_id,v_occurred,now())
 on conflict(reported_by,client_request_id) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.goal_events where reported_by=v_user and client_request_id=p_client_request_id; end if;
 return v_id;
end $$;
grant execute on function public.add_approved_match_goal(uuid,uuid,uuid) to authenticated;

create or replace function public.review_goal_report(p_goal_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=(select auth.uid());g public.goal_events;v_team uuid;m_status public.match_status;
begin
 select * into g from public.goal_events where id=p_goal_id for update;
 if not found then raise exception 'דיווח השער לא נמצא'; end if;
 if not public.is_match_result_manager(g.match_id) then raise exception 'אין הרשאה לטפל בדיווח'; end if;
 if g.status<>'pending' then raise exception 'הדיווח כבר טופל'; end if;
 if p_approve and g.reported_by=v_user then raise exception 'לא ניתן לאשר דיווח שהגשת בעצמך; ניתן להשתמש בהוספה ישירה'; end if;
 select status into m_status from public.matches where id=g.match_id;
 if p_approve and m_status='cancelled' then raise exception 'לא ניתן לאשר שער במשחק שבוטל'; end if;
 if p_approve and not exists(select 1 from public.match_registrations where match_id=g.match_id and user_id=g.scorer_user_id and registration_status='confirmed' and attended=true) then
  raise exception 'המבקיע אינו מסומן עוד כמשתתף במשחק';
 end if;
 if p_approve then
  select tp.team_id into v_team from public.team_players tp join public.teams t on t.id=tp.team_id
  where t.match_id=g.match_id and t.is_published=true and tp.user_id=g.scorer_user_id order by t.generation_version desc limit 1;
 end if;
 update public.goal_events set status=case when p_approve then 'approved'::public.goal_event_status else 'rejected'::public.goal_event_status end,
  team_id=case when p_approve then v_team else team_id end,reviewed_by=v_user,reviewed_at=now()
 where id=p_goal_id;
end $$;
grant execute on function public.review_goal_report(uuid,boolean) to authenticated;

create or replace function public.cancel_approved_goal(p_goal_id uuid,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare g public.goal_events;
begin
 select * into g from public.goal_events where id=p_goal_id for update;
 if not found then raise exception 'השער לא נמצא'; end if;
 if not public.is_match_result_manager(g.match_id) then raise exception 'אין הרשאה לבטל שער'; end if;
 if g.status<>'approved' then raise exception 'ניתן לבטל רק שער מאושר'; end if;
 update public.goal_events set status='cancelled',reviewed_by=(select auth.uid()),cancelled_at=now(),cancellation_reason=nullif(trim(p_reason),'') where id=p_goal_id;
end $$;
grant execute on function public.cancel_approved_goal(uuid,text) to authenticated;

create or replace function public.reject_pending_goals_for_cancelled_match() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status='cancelled' and old.status is distinct from new.status then
  update public.goal_events set status='rejected',reviewed_at=now(),cancellation_reason='match_cancelled'
  where match_id=new.id and status='pending';
 end if;
 return new;
end $$;
drop trigger if exists reject_goals_when_match_cancelled on public.matches;
create trigger reject_goals_when_match_cancelled after update of status on public.matches for each row execute function public.reject_pending_goals_for_cancelled_match();

create or replace function public.invalidate_goals_when_participant_removed() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.registration_status='confirmed' and old.attended=true
  and (new.registration_status<>'confirmed' or new.attended=false) then
  update public.goal_events
  set status=case when status='approved' then 'cancelled'::public.goal_event_status else 'rejected'::public.goal_event_status end,
   reviewed_by=(select auth.uid()),reviewed_at=coalesce(reviewed_at,now()),
   cancelled_at=case when status='approved' then now() else cancelled_at end,
   cancellation_reason='participant_removed'
  where match_id=new.match_id and scorer_user_id=new.user_id and status in ('pending','approved');
 end if;
 return new;
end $$;
drop trigger if exists invalidate_goals_on_participation_change on public.match_registrations;
create trigger invalidate_goals_on_participation_change after update of registration_status,attended on public.match_registrations
for each row execute function public.invalidate_goals_when_participant_removed();

create or replace function public.get_group_goal_leaderboard(p_group_id uuid,p_month date default null)
returns table(user_id uuid,first_name text,last_name text,goals bigint)
language sql stable security definer set search_path=public as $$
 select ge.scorer_user_id,p.first_name,p.last_name,count(*) goals
 from public.goal_events ge join public.matches m on m.id=ge.match_id join public.profiles p on p.id=ge.scorer_user_id
 where m.group_id=p_group_id and ge.status='approved' and public.is_group_member(p_group_id)
  and (p_month is null or (ge.occurred_at at time zone 'Asia/Jerusalem')>=date_trunc('month',p_month)::timestamp
   and (ge.occurred_at at time zone 'Asia/Jerusalem')<(date_trunc('month',p_month)+interval '1 month')::timestamp)
 group by ge.scorer_user_id,p.first_name,p.last_name order by goals desc,p.first_name,p.last_name;
$$;
grant execute on function public.get_group_goal_leaderboard(uuid,date) to authenticated;

create or replace function public.get_player_goal_stats(p_user_id uuid,p_group_id uuid,p_match_id uuid default null)
returns table(total_goals bigint,monthly_goals bigint,current_match_goals bigint,current_match_id uuid)
language sql stable security definer set search_path=public as $$
 with active_match as(
  select m.id from public.matches m where m.group_id=p_group_id and m.status not in ('completed','cancelled')
   and (clock_timestamp() at time zone 'Asia/Jerusalem')>=m.match_date+m.start_time
   and (clock_timestamp() at time zone 'Asia/Jerusalem')<=case when m.end_time is null then m.match_date+m.start_time+interval '2 hours' when m.end_time<m.start_time then m.match_date+m.end_time+interval '1 day' else m.match_date+m.end_time end
  order by m.match_date desc,m.start_time desc limit 1
 ), chosen as(select coalesce(p_match_id,(select id from active_match)) id)
 select
  count(*) filter(where ge.status='approved'),
  count(*) filter(where ge.status='approved' and (ge.occurred_at at time zone 'Asia/Jerusalem')>=date_trunc('month',clock_timestamp() at time zone 'Asia/Jerusalem') and (ge.occurred_at at time zone 'Asia/Jerusalem')<date_trunc('month',clock_timestamp() at time zone 'Asia/Jerusalem')+interval '1 month'),
  count(*) filter(where ge.status='approved' and ge.match_id=(select id from chosen)),
  (select id from chosen)
 from public.matches m left join public.goal_events ge on ge.match_id=m.id and ge.scorer_user_id=p_user_id
 where m.group_id=p_group_id and public.is_group_member(p_group_id);
$$;
grant execute on function public.get_player_goal_stats(uuid,uuid,uuid) to authenticated;

do $$ begin alter publication supabase_realtime add table public.goal_events; exception when duplicate_object then null; end $$;

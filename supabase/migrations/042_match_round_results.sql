-- Per-match round results: team wins and goalkeeper clean sheets.
-- These event tables intentionally do not feed player_public_stats or any
-- monthly/all-time leaderboard. They exist only for the match-night summary.

create table if not exists public.match_team_win_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  constraint match_team_win_request_unique unique(recorded_by,client_request_id)
);

create table if not exists public.match_clean_sheet_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  goalkeeper_user_id uuid references public.profiles(id) on delete restrict,
  goalkeeper_guest_id uuid references public.match_guests(id) on delete restrict,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  constraint match_clean_sheet_request_unique unique(recorded_by,client_request_id),
  constraint match_clean_sheet_goalkeeper_check check(
    (goalkeeper_user_id is not null and goalkeeper_guest_id is null)
    or (goalkeeper_user_id is null and goalkeeper_guest_id is not null)
  )
);

create index if not exists match_team_wins_active_idx
  on public.match_team_win_events(match_id,team_id,created_at desc)
  where cancelled_at is null;
create index if not exists match_clean_sheets_active_idx
  on public.match_clean_sheet_events(match_id,team_id,created_at desc)
  where cancelled_at is null;

alter table public.match_team_win_events enable row level security;
alter table public.match_clean_sheet_events enable row level security;

drop policy if exists "round wins visible to group" on public.match_team_win_events;
create policy "round wins visible to group"
on public.match_team_win_events for select to authenticated
using(exists(
  select 1 from public.matches m
  where m.id=match_team_win_events.match_id and public.is_group_member(m.group_id)
) or public.is_system_admin());

drop policy if exists "clean sheets visible to group" on public.match_clean_sheet_events;
create policy "clean sheets visible to group"
on public.match_clean_sheet_events for select to authenticated
using(exists(
  select 1 from public.matches m
  where m.id=match_clean_sheet_events.match_id and public.is_group_member(m.group_id)
) or public.is_system_admin());

revoke insert,update,delete on public.match_team_win_events from anon,authenticated;
revoke insert,update,delete on public.match_clean_sheet_events from anon,authenticated;
grant select on public.match_team_win_events to authenticated;
grant select on public.match_clean_sheet_events to authenticated;

create or replace function public.add_match_team_win(
  p_match_id uuid,p_team_id uuid,p_client_request_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare m public.matches;v_id uuid;v_user uuid:=(select auth.uid());v_local_now timestamp;
begin
  if v_user is null then raise exception 'יש להתחבר כדי לעדכן תוצאות'; end if;
  if p_client_request_id is null then raise exception 'מזהה הבקשה חסר'; end if;
  select * into m from public.matches where id=p_match_id;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.is_match_result_manager(p_match_id) then
    raise exception 'אין הרשאה לעדכן ניצחונות';
  end if;
  v_local_now:=clock_timestamp() at time zone 'Asia/Jerusalem';
  if v_local_now<(m.match_date+m.start_time) then raise exception 'לא ניתן לעדכן ניצחון לפני תחילת המשחק'; end if;
  if m.status='cancelled' then raise exception 'לא ניתן לעדכן משחק שבוטל'; end if;
  if not exists(select 1 from public.teams t where t.id=p_team_id and t.match_id=p_match_id and t.is_published=true) then
    raise exception 'הקבוצה אינה חלק מהחלוקה הפעילה';
  end if;
  insert into public.match_team_win_events(match_id,team_id,recorded_by,client_request_id)
  values(p_match_id,p_team_id,v_user,p_client_request_id)
  on conflict(recorded_by,client_request_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.match_team_win_events where recorded_by=v_user and client_request_id=p_client_request_id;
  end if;
  return v_id;
end $$;

create or replace function public.cancel_match_team_win(p_event_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare e public.match_team_win_events;
begin
  select * into e from public.match_team_win_events where id=p_event_id for update;
  if not found then raise exception 'אירוע הניצחון לא נמצא'; end if;
  if not public.is_match_result_manager(e.match_id) then
    raise exception 'אין הרשאה לתקן ניצחונות';
  end if;
  if e.cancelled_at is not null then return; end if;
  update public.match_team_win_events
  set cancelled_at=now(),cancelled_by=(select auth.uid()) where id=p_event_id;
end $$;

create or replace function public.add_match_clean_sheet(
  p_match_id uuid,p_goalkeeper_user_id uuid,p_goalkeeper_guest_id uuid,p_client_request_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare m public.matches;v_id uuid;v_team uuid;v_user uuid:=(select auth.uid());v_local_now timestamp;
begin
  if v_user is null then raise exception 'יש להתחבר כדי לעדכן תוצאות'; end if;
  if p_client_request_id is null then raise exception 'מזהה הבקשה חסר'; end if;
  select * into m from public.matches where id=p_match_id;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.is_match_result_manager(p_match_id) then
    raise exception 'אין הרשאה לעדכן שערים נקיים';
  end if;
  if (p_goalkeeper_user_id is null)=(p_goalkeeper_guest_id is null) then
    raise exception 'יש לבחור שוער אחד';
  end if;
  v_local_now:=clock_timestamp() at time zone 'Asia/Jerusalem';
  if v_local_now<(m.match_date+m.start_time) then raise exception 'לא ניתן לעדכן שער נקי לפני תחילת המשחק'; end if;
  if m.status='cancelled' then raise exception 'לא ניתן לעדכן משחק שבוטל'; end if;
  if p_goalkeeper_user_id is not null and not exists(
    select 1 from public.match_registrations mr
    where mr.match_id=p_match_id and mr.user_id=p_goalkeeper_user_id
      and mr.registration_status='confirmed' and mr.attended=true
  ) then raise exception 'ניתן לסמן שער נקי רק לשחקן שנכח במשחק'; end if;
  if p_goalkeeper_guest_id is not null and not exists(
    select 1 from public.match_guests mg
    where mg.id=p_goalkeeper_guest_id and mg.match_id=p_match_id and mg.attended=true
  ) then raise exception 'ניתן לסמן שער נקי רק לאורח שנכח במשחק'; end if;
  select tp.team_id into v_team
  from public.team_players tp join public.teams t on t.id=tp.team_id
  where t.match_id=p_match_id and t.is_published=true
    and (tp.user_id=p_goalkeeper_user_id or tp.guest_id=p_goalkeeper_guest_id)
  order by t.generation_version desc limit 1;
  if v_team is null then raise exception 'השחקן אינו משויך לקבוצה בחלוקה הפעילה'; end if;
  insert into public.match_clean_sheet_events(match_id,team_id,goalkeeper_user_id,goalkeeper_guest_id,recorded_by,client_request_id)
  values(p_match_id,v_team,p_goalkeeper_user_id,p_goalkeeper_guest_id,v_user,p_client_request_id)
  on conflict(recorded_by,client_request_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.match_clean_sheet_events where recorded_by=v_user and client_request_id=p_client_request_id;
  end if;
  return v_id;
end $$;

create or replace function public.cancel_match_clean_sheet(p_event_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare e public.match_clean_sheet_events;
begin
  select * into e from public.match_clean_sheet_events where id=p_event_id for update;
  if not found then raise exception 'אירוע השער הנקי לא נמצא'; end if;
  if not public.is_match_result_manager(e.match_id) then
    raise exception 'אין הרשאה לתקן שערים נקיים';
  end if;
  if e.cancelled_at is not null then return; end if;
  update public.match_clean_sheet_events
  set cancelled_at=now(),cancelled_by=(select auth.uid()) where id=p_event_id;
end $$;

revoke all on function public.add_match_team_win(uuid,uuid,uuid) from public,anon;
revoke all on function public.cancel_match_team_win(uuid) from public,anon;
revoke all on function public.add_match_clean_sheet(uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.cancel_match_clean_sheet(uuid) from public,anon;
grant execute on function public.add_match_team_win(uuid,uuid,uuid) to authenticated;
grant execute on function public.cancel_match_team_win(uuid) to authenticated;
grant execute on function public.add_match_clean_sheet(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.cancel_match_clean_sheet(uuid) to authenticated;

create or replace function public.cancel_round_results_for_cancelled_match()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='cancelled' and old.status is distinct from new.status then
    update public.match_team_win_events
      set cancelled_at=coalesce(cancelled_at,now()),cancelled_by=coalesce(cancelled_by,(select auth.uid()))
      where match_id=new.id and cancelled_at is null;
    update public.match_clean_sheet_events
      set cancelled_at=coalesce(cancelled_at,now()),cancelled_by=coalesce(cancelled_by,(select auth.uid()))
      where match_id=new.id and cancelled_at is null;
  end if;
  return new;
end $$;
revoke all on function public.cancel_round_results_for_cancelled_match() from public,anon,authenticated;
drop trigger if exists cancel_round_results_when_match_cancelled on public.matches;
create trigger cancel_round_results_when_match_cancelled
after update of status on public.matches for each row
execute function public.cancel_round_results_for_cancelled_match();

do $$ begin
  alter publication supabase_realtime add table public.match_team_win_events;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.match_clean_sheet_events;
exception when duplicate_object then null; end $$;

-- Shared, persistent round timer for a match night.
-- The timer is operational state only and is intentionally excluded from stats.

create table if not exists public.match_round_timers (
  match_id uuid primary key references public.matches(id) on delete cascade,
  duration_seconds integer not null default 420 check(duration_seconds between 30 and 5400),
  remaining_seconds integer not null default 420 check(remaining_seconds between 0 and 5400),
  status text not null default 'idle' check(status in ('idle','running','paused','finished')),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  constraint match_round_timer_running_check check(
    (status='running' and started_at is not null)
    or (status<>'running' and started_at is null)
  ),
  constraint match_round_timer_remaining_check check(remaining_seconds<=duration_seconds)
);

alter table public.match_round_timers enable row level security;
drop policy if exists "round timer visible to group" on public.match_round_timers;
create policy "round timer visible to group"
on public.match_round_timers for select to authenticated
using(exists(
  select 1 from public.matches m
  where m.id=match_round_timers.match_id and public.is_group_member(m.group_id)
) or public.is_system_admin());

revoke insert,update,delete on public.match_round_timers from anon,authenticated;
grant select on public.match_round_timers to authenticated;

create or replace function public.set_match_round_timer(
  p_match_id uuid,p_duration_seconds integer
) returns void language plpgsql security definer set search_path=public as $$
declare m public.matches;v_user uuid:=(select auth.uid());
begin
  if v_user is null then raise exception 'יש להתחבר כדי להגדיר טיימר'; end if;
  select * into m from public.matches where id=p_match_id;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.is_match_result_manager(p_match_id) then raise exception 'אין הרשאה לנהל את הטיימר'; end if;
  if m.status not in ('teams_published','completed') then raise exception 'ניתן להגדיר טיימר רק לאחר פרסום הקבוצות'; end if;
  if m.status='completed' or m.ratings_open then raise exception 'המשחק כבר הסתיים'; end if;
  if p_duration_seconds not between 30 and 5400 then raise exception 'יש לבחור זמן בין 30 שניות ל־90 דקות'; end if;
  insert into public.match_round_timers(match_id,duration_seconds,remaining_seconds,status,started_at,updated_at,updated_by)
  values(p_match_id,p_duration_seconds,p_duration_seconds,'idle',null,now(),v_user)
  on conflict(match_id) do update set
    duration_seconds=excluded.duration_seconds,
    remaining_seconds=excluded.duration_seconds,
    status='idle',started_at=null,updated_at=now(),updated_by=v_user;
end $$;

create or replace function public.start_match_round_timer(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare m public.matches;t public.match_round_timers;v_user uuid:=(select auth.uid());v_remaining integer;
begin
  if v_user is null then raise exception 'יש להתחבר כדי להפעיל טיימר'; end if;
  select * into m from public.matches where id=p_match_id;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.is_match_result_manager(p_match_id) then raise exception 'אין הרשאה לנהל את הטיימר'; end if;
  if m.status<>'teams_published' or m.ratings_open then raise exception 'הטיימר זמין רק בזמן משחק פעיל'; end if;
  insert into public.match_round_timers(match_id,duration_seconds,remaining_seconds,status,started_at,updated_by)
  values(p_match_id,420,420,'idle',null,v_user)
  on conflict(match_id) do nothing;
  select * into t from public.match_round_timers where match_id=p_match_id for update;
  if t.status='running' then
    v_remaining:=greatest(0,t.remaining_seconds-floor(extract(epoch from (clock_timestamp()-t.started_at)))::integer);
    if v_remaining>0 then return; end if;
  else
    v_remaining:=t.remaining_seconds;
  end if;
  if v_remaining<=0 or t.status in ('idle','finished') then v_remaining:=t.duration_seconds; end if;
  update public.match_round_timers set
    remaining_seconds=v_remaining,status='running',started_at=clock_timestamp(),updated_at=now(),updated_by=v_user
  where match_id=p_match_id;
end $$;

create or replace function public.pause_match_round_timer(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t public.match_round_timers;v_user uuid:=(select auth.uid());v_remaining integer;
begin
  if v_user is null then raise exception 'יש להתחבר כדי לעצור טיימר'; end if;
  if not public.is_match_result_manager(p_match_id) then raise exception 'אין הרשאה לנהל את הטיימר'; end if;
  select * into t from public.match_round_timers where match_id=p_match_id for update;
  if not found or t.status<>'running' then return; end if;
  v_remaining:=greatest(0,t.remaining_seconds-floor(extract(epoch from (clock_timestamp()-t.started_at)))::integer);
  update public.match_round_timers set
    remaining_seconds=v_remaining,
    status=case when v_remaining=0 then 'finished' else 'paused' end,
    started_at=null,updated_at=now(),updated_by=v_user
  where match_id=p_match_id;
end $$;

revoke all on function public.set_match_round_timer(uuid,integer) from public,anon;
revoke all on function public.start_match_round_timer(uuid) from public,anon;
revoke all on function public.pause_match_round_timer(uuid) from public,anon;
grant execute on function public.set_match_round_timer(uuid,integer) to authenticated;
grant execute on function public.start_match_round_timer(uuid) to authenticated;
grant execute on function public.pause_match_round_timer(uuid) to authenticated;

create or replace function public.stop_round_timer_after_match()
returns trigger language plpgsql security definer set search_path=public as $$
declare t public.match_round_timers;v_remaining integer;
begin
  if new.status in ('completed','cancelled') and old.status is distinct from new.status then
    select * into t from public.match_round_timers where match_id=new.id for update;
    if found and t.status='running' then
      v_remaining:=greatest(0,t.remaining_seconds-floor(extract(epoch from (clock_timestamp()-t.started_at)))::integer);
      update public.match_round_timers set
        remaining_seconds=v_remaining,
        status=case when v_remaining=0 then 'finished' else 'paused' end,
        started_at=null,updated_at=now()
      where match_id=new.id;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.stop_round_timer_after_match() from public,anon,authenticated;
drop trigger if exists stop_round_timer_after_match on public.matches;
create trigger stop_round_timer_after_match
after update of status on public.matches for each row execute function public.stop_round_timer_after_match();

do $$ begin
  alter publication supabase_realtime add table public.match_round_timers;
exception when duplicate_object then null; end $$;

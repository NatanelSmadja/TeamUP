-- TEAMUP V2.2: explicit weekly response + truly anonymous public ratings

create table if not exists public.weekly_poll_responses (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.weekly_polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null check (response in ('unavailable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(poll_id,user_id)
);

alter table public.weekly_poll_responses enable row level security;
drop policy if exists "poll responses visible to group" on public.weekly_poll_responses;
create policy "poll responses visible to group" on public.weekly_poll_responses for select to authenticated
using(exists(select 1 from public.weekly_polls p where p.id=poll_id and public.is_group_member(p.group_id)));
drop policy if exists "users add own poll response" on public.weekly_poll_responses;
create policy "users add own poll response" on public.weekly_poll_responses for insert to authenticated
with check(user_id=(select auth.uid()) and exists(select 1 from public.weekly_polls p where p.id=poll_id and p.status='open' and public.is_group_member(p.group_id)));
drop policy if exists "users update own poll response" on public.weekly_poll_responses;
create policy "users update own poll response" on public.weekly_poll_responses for update to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists "users remove own poll response" on public.weekly_poll_responses;
create policy "users remove own poll response" on public.weekly_poll_responses for delete to authenticated
using(user_id=(select auth.uid()));

do $$ begin alter publication supabase_realtime add table public.weekly_poll_responses; exception when duplicate_object then null; end $$;

create or replace function public.toggle_weekly_availability(p_poll_id uuid,p_day integer default null,p_unavailable boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid := auth.uid();
begin
 if v_user is null then raise exception 'Not authenticated'; end if;
 if not exists(select 1 from public.weekly_polls p where p.id=p_poll_id and p.status='open' and public.is_group_member(p.group_id)) then
  raise exception 'הסקר אינו פתוח או שאין לך גישה';
 end if;
 if p_unavailable then
  delete from public.availability_votes where poll_id=p_poll_id and user_id=v_user;
  insert into public.weekly_poll_responses(poll_id,user_id,response,updated_at)
  values(p_poll_id,v_user,'unavailable',now())
  on conflict(poll_id,user_id) do update set response='unavailable',updated_at=now();
 else
  if p_day is null or p_day not between 0 and 6 then raise exception 'יום לא תקין'; end if;
  delete from public.weekly_poll_responses where poll_id=p_poll_id and user_id=v_user;
  if exists(select 1 from public.availability_votes where poll_id=p_poll_id and user_id=v_user and day_of_week=p_day) then
   delete from public.availability_votes where poll_id=p_poll_id and user_id=v_user and day_of_week=p_day;
  else
   insert into public.availability_votes(poll_id,user_id,day_of_week) values(p_poll_id,v_user,p_day)
   on conflict(poll_id,user_id,day_of_week) do nothing;
  end if;
 end if;
end $$;
grant execute on function public.toggle_weekly_availability(uuid,integer,boolean) to authenticated;

-- Public aggregate table contains no voter/rater identity.
create table if not exists public.player_public_stats (
 group_id uuid not null references public.groups(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 avg_rating numeric(4,2) not null default 3,
 rating_count integer not null default 0,
 mvp_count integer not null default 0,
 games_count integer not null default 0,
 updated_at timestamptz not null default now(),
 primary key(group_id,user_id)
);
alter table public.player_public_stats enable row level security;
drop policy if exists "public stats visible to group" on public.player_public_stats;
create policy "public stats visible to group" on public.player_public_stats for select to authenticated using(public.is_group_member(group_id));
do $$ begin alter publication supabase_realtime add table public.player_public_stats; exception when duplicate_object then null; end $$;

create or replace function public.refresh_player_public_stats(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare g record;
begin
 for g in select group_id from public.group_members where user_id=p_user_id loop
  insert into public.player_public_stats(group_id,user_id,avg_rating,rating_count,mvp_count,games_count,updated_at)
  select g.group_id,p_user_id,
   coalesce((select round(avg(pr.overall_rating)::numeric,2) from public.player_ratings pr join public.matches m on m.id=pr.match_id where pr.rated_user_id=p_user_id and m.group_id=g.group_id),
            (select coalesce(base_rating,3) from public.profiles where id=p_user_id),3),
   (select count(*) from public.player_ratings pr join public.matches m on m.id=pr.match_id where pr.rated_user_id=p_user_id and m.group_id=g.group_id),
   (select count(*) from public.mvp_votes mv join public.matches m on m.id=mv.match_id where mv.voted_user_id=p_user_id and m.group_id=g.group_id),
   (select count(*) from public.match_registrations mr join public.matches m on m.id=mr.match_id where mr.user_id=p_user_id and mr.registration_status='confirmed' and m.group_id=g.group_id),now()
  on conflict(group_id,user_id) do update set avg_rating=excluded.avg_rating,rating_count=excluded.rating_count,mvp_count=excluded.mvp_count,games_count=excluded.games_count,updated_at=now();
 end loop;
end $$;

create or replace function public.refresh_stats_from_rating() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.refresh_player_public_stats(coalesce(new.rated_user_id,old.rated_user_id)); return coalesce(new,old); end $$;
create or replace function public.refresh_stats_from_mvp() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.refresh_player_public_stats(coalesce(new.voted_user_id,old.voted_user_id)); return coalesce(new,old); end $$;
create or replace function public.refresh_stats_from_registration() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.refresh_player_public_stats(coalesce(new.user_id,old.user_id)); return coalesce(new,old); end $$;
drop trigger if exists refresh_public_stats_rating on public.player_ratings;
create trigger refresh_public_stats_rating after insert or update or delete on public.player_ratings for each row execute function public.refresh_stats_from_rating();
drop trigger if exists refresh_public_stats_mvp on public.mvp_votes;
create trigger refresh_public_stats_mvp after insert or update or delete on public.mvp_votes for each row execute function public.refresh_stats_from_mvp();
drop trigger if exists refresh_public_stats_registration on public.match_registrations;
create trigger refresh_public_stats_registration after insert or update or delete on public.match_registrations for each row execute function public.refresh_stats_from_registration();

-- Direct rows are private: a user can only read their own submitted ratings/vote.
drop policy if exists "ratings visible after match" on public.player_ratings;
drop policy if exists "ratings read own" on public.player_ratings;
create policy "ratings read own" on public.player_ratings for select to authenticated using(rater_user_id=(select auth.uid()));
drop policy if exists "mvp votes visible" on public.mvp_votes;
drop policy if exists "mvp read own" on public.mvp_votes;
create policy "mvp read own" on public.mvp_votes for select to authenticated using(voter_user_id=(select auth.uid()));

create or replace function public.get_player_rating_trend(p_user_id uuid,p_group_id uuid)
returns table(match_date date,avg_rating numeric,rating_count bigint)
language sql security definer set search_path=public stable as $$
 select m.match_date,round(avg(pr.overall_rating)::numeric,2),count(*)
 from public.player_ratings pr join public.matches m on m.id=pr.match_id
 where pr.rated_user_id=p_user_id and m.group_id=p_group_id and public.is_group_member(p_group_id)
 group by m.id,m.match_date order by m.match_date;
$$;
grant execute on function public.get_player_rating_trend(uuid,uuid) to authenticated;

-- Backfill aggregate data.
do $$ declare r record; begin for r in select distinct user_id from public.group_members loop perform public.refresh_player_public_stats(r.user_id); end loop; end $$;

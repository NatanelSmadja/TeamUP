-- MVP is a per-match award, not a count of votes received. A match has one
-- deterministic winner: votes, approved goals, match rating, profile base rating,
-- and finally user id as a stable last-resort tie breaker.

create or replace function public.get_match_mvp_winner(p_match_id uuid)
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  with vote_totals as (
    select mv.voted_user_id user_id,count(*) votes
    from public.mvp_votes mv
    where mv.match_id=p_match_id
    group by mv.voted_user_id
  ), goal_totals as (
    select ge.scorer_user_id user_id,count(*) goals
    from public.goal_events ge
    where ge.match_id=p_match_id and ge.status='approved'
    group by ge.scorer_user_id
  ), match_ratings as (
    select pr.rated_user_id user_id,avg(pr.overall_rating) avg_rating
    from public.player_ratings pr
    where pr.match_id=p_match_id
    group by pr.rated_user_id
  )
  select votes.user_id
  from vote_totals votes
  left join goal_totals goals on goals.user_id=votes.user_id
  left join match_ratings current_rating on current_rating.user_id=votes.user_id
  left join public.profiles p on p.id=votes.user_id
  order by votes.votes desc,
    coalesce(goals.goals,0) desc,
    coalesce(current_rating.avg_rating,0) desc,
    coalesce(p.base_rating,3) desc,
    votes.user_id
  limit 1;
$$;
revoke all on function public.get_match_mvp_winner(uuid) from public,anon,authenticated;

-- Rebuild the cached public row. Games are counted only after completion and
-- MVP count is the number of matches won, never the number of ballots received.
create or replace function public.refresh_player_public_stats(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare g record;
begin
  for g in select distinct group_id from public.group_members where user_id=p_user_id loop
    insert into public.player_public_stats(group_id,user_id,avg_rating,rating_count,mvp_count,games_count,updated_at)
    select g.group_id,p_user_id,
      coalesce((
        select round(avg(pr.overall_rating)::numeric,2)
        from public.player_ratings pr
        join public.matches m on m.id=pr.match_id
        where pr.rated_user_id=p_user_id and m.group_id=g.group_id and m.status='completed'
      ),(select coalesce(base_rating,3) from public.profiles where id=p_user_id),3),
      (select count(*)
       from public.player_ratings pr join public.matches m on m.id=pr.match_id
       where pr.rated_user_id=p_user_id and m.group_id=g.group_id and m.status='completed'),
      (select count(*)
       from public.matches m
       where m.group_id=g.group_id and m.status='completed'
         and public.get_match_mvp_winner(m.id)=p_user_id),
      (select count(*)
       from public.match_registrations mr join public.matches m on m.id=mr.match_id
       where mr.user_id=p_user_id and mr.registration_status='confirmed' and mr.attended=true
         and m.group_id=g.group_id and m.status='completed'),
      now()
    on conflict(group_id,user_id) do update set
      avg_rating=excluded.avg_rating,
      rating_count=excluded.rating_count,
      mvp_count=excluded.mvp_count,
      games_count=excluded.games_count,
      updated_at=now();
  end loop;
end;
$$;
revoke all on function public.refresh_player_public_stats(uuid) from public,anon,authenticated;

-- A vote or a rating can change the winner because ratings are a tie breaker.
-- Refresh every participant in the affected match so both the previous and the
-- new winner are corrected atomically.
create or replace function public.refresh_match_participant_stats(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare participant record;
begin
  if p_match_id is null then return; end if;
  for participant in
    select distinct mr.user_id
    from public.match_registrations mr
    where mr.match_id=p_match_id
  loop
    perform public.refresh_player_public_stats(participant.user_id);
  end loop;
end;
$$;
revoke all on function public.refresh_match_participant_stats(uuid) from public,anon,authenticated;

create or replace function public.refresh_stats_from_rating()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    perform public.refresh_match_participant_stats(old.match_id);
    return old;
  end if;
  if tg_op='UPDATE' and old.match_id is distinct from new.match_id then
    perform public.refresh_match_participant_stats(old.match_id);
  end if;
  perform public.refresh_match_participant_stats(new.match_id);
  return new;
end;
$$;

create or replace function public.refresh_stats_from_mvp()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    perform public.refresh_match_participant_stats(old.match_id);
    return old;
  end if;
  if tg_op='UPDATE' and old.match_id is distinct from new.match_id then
    perform public.refresh_match_participant_stats(old.match_id);
  end if;
  perform public.refresh_match_participant_stats(new.match_id);
  return new;
end;
$$;
revoke all on function public.refresh_stats_from_rating() from public,anon,authenticated;
revoke all on function public.refresh_stats_from_mvp() from public,anon,authenticated;

create or replace function public.refresh_stats_from_goal()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    perform public.refresh_match_participant_stats(old.match_id);
    return old;
  end if;
  if tg_op='UPDATE' and old.match_id is distinct from new.match_id then
    perform public.refresh_match_participant_stats(old.match_id);
  end if;
  perform public.refresh_match_participant_stats(new.match_id);
  return new;
end;
$$;
revoke all on function public.refresh_stats_from_goal() from public,anon,authenticated;

drop trigger if exists refresh_public_stats_goal on public.goal_events;
create trigger refresh_public_stats_goal
after insert or update or delete on public.goal_events
for each row execute function public.refresh_stats_from_goal();

-- Attendance is normally marked before the match is completed. Refresh again
-- when status changes so a completed appearance is added at the correct time,
-- and removed again if a match is subsequently cancelled.
create or replace function public.refresh_stats_from_match_status()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if old.status is distinct from new.status
     and (old.status in ('completed','cancelled') or new.status in ('completed','cancelled')) then
    perform public.refresh_match_participant_stats(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.refresh_stats_from_match_status() from public,anon,authenticated;

drop trigger if exists refresh_public_stats_match_status on public.matches;
create trigger refresh_public_stats_match_status
after update of status on public.matches
for each row execute function public.refresh_stats_from_match_status();

-- Monthly award uses match dates and one MVP win per completed match.
create or replace function public.get_player_of_month(
  p_group_id uuid,
  p_month date default date_trunc('month',current_date)::date
)
returns table(user_id uuid,first_name text,last_name text,avg_rating numeric,rating_count bigint,mvp_count bigint,games_count bigint,score numeric)
language sql
stable
security definer
set search_path=public
as $$
  with month_matches as (
    select m.id,m.match_date
    from public.matches m
    where m.group_id=p_group_id and m.status='completed'
      and m.match_date>=date_trunc('month',p_month)::date
      and m.match_date<(date_trunc('month',p_month)+interval '1 month')::date
  ), ratings as (
    select pr.rated_user_id user_id,avg(pr.overall_rating)::numeric(4,2) avg_rating,count(*) rating_count
    from public.player_ratings pr join month_matches mm on mm.id=pr.match_id
    group by pr.rated_user_id
  ), mvps as (
    select winner.user_id,count(*) mvp_count
    from month_matches mm
    cross join lateral (select public.get_match_mvp_winner(mm.id) user_id) winner
    where winner.user_id is not null
    group by winner.user_id
  ), games as (
    select mr.user_id,count(*) games_count
    from public.match_registrations mr join month_matches mm on mm.id=mr.match_id
    where mr.registration_status='confirmed' and mr.attended=true
    group by mr.user_id
  )
  select p.id,p.first_name,p.last_name,
    coalesce(r.avg_rating,0),coalesce(r.rating_count,0),coalesce(v.mvp_count,0),coalesce(g.games_count,0),
    (coalesce(r.avg_rating,0)*20+coalesce(v.mvp_count,0)*8+coalesce(g.games_count,0)*2)::numeric(8,2)
  from public.profiles p
  join public.group_members gm on gm.user_id=p.id and gm.group_id=p_group_id and gm.status='active'
  left join ratings r on r.user_id=p.id
  left join mvps v on v.user_id=p.id
  left join games g on g.user_id=p.id
  where public.is_group_member(p_group_id)
    and (coalesce(r.rating_count,0)>0 or coalesce(v.mvp_count,0)>0 or coalesce(g.games_count,0)>0)
  order by 8 desc,5 desc,p.id
  limit 1;
$$;
revoke all on function public.get_player_of_month(uuid,date) from public,anon;
grant execute on function public.get_player_of_month(uuid,date) to authenticated;

-- Keep the system-admin card aligned with the public interpretation of games
-- and MVP wins.
create or replace function public.system_admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare p public.profiles;v_groups jsonb;v_summary jsonb;
begin
  if not public.is_system_admin() then raise exception 'אין הרשאת מערכת'; end if;
  select * into p from public.profiles where id=p_user_id;
  if not found then raise exception 'המשתמש לא נמצא'; end if;

  select jsonb_build_object(
    'groups',count(distinct gm.group_id) filter(where gm.status='active' and g.lifecycle_status='active'),
    'games',(select count(*) from public.match_registrations mr join public.matches m on m.id=mr.match_id where mr.user_id=p_user_id and mr.registration_status='confirmed' and mr.attended=true and m.status='completed'),
    'rating_count',(select count(*) from public.player_ratings pr join public.matches m on m.id=pr.match_id where pr.rated_user_id=p_user_id and m.status='completed'),
    'avg_rating',coalesce((select round(avg(pr.overall_rating)::numeric,2) from public.player_ratings pr join public.matches m on m.id=pr.match_id where pr.rated_user_id=p_user_id and m.status='completed'),p.base_rating,3),
    'mvp',(select count(*) from public.matches m where m.status='completed' and public.get_match_mvp_winner(m.id)=p_user_id),
    'goals',(select count(*) from public.goal_events ge where ge.scorer_user_id=p_user_id and ge.status='approved')
  ) into v_summary
  from public.group_members gm join public.groups g on g.id=gm.group_id
  where gm.user_id=p_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'group_id',g.id,'name',g.name,'role',gm.role,'membership_status',gm.status,
    'group_status',g.lifecycle_status,'is_owner',g.owner_id=p_user_id,'joined_at',gm.joined_at,
    'games',(select count(*) from public.match_registrations mr join public.matches m on m.id=mr.match_id where m.group_id=g.id and m.status='completed' and mr.user_id=p_user_id and mr.registration_status='confirmed' and mr.attended=true),
    'rating_count',(select count(*) from public.player_ratings pr join public.matches m on m.id=pr.match_id where m.group_id=g.id and m.status='completed' and pr.rated_user_id=p_user_id),
    'avg_rating',coalesce((select round(avg(pr.overall_rating)::numeric,2) from public.player_ratings pr join public.matches m on m.id=pr.match_id where m.group_id=g.id and m.status='completed' and pr.rated_user_id=p_user_id),p.base_rating,3),
    'mvp',(select count(*) from public.matches m where m.group_id=g.id and m.status='completed' and public.get_match_mvp_winner(m.id)=p_user_id),
    'goals',(select count(*) from public.goal_events ge join public.matches m on m.id=ge.match_id where m.group_id=g.id and ge.scorer_user_id=p_user_id and ge.status='approved')
  ) order by (gm.status='active' and g.lifecycle_status='active') desc,gm.joined_at desc),'[]'::jsonb)
  into v_groups
  from public.group_members gm join public.groups g on g.id=gm.group_id
  where gm.user_id=p_user_id;

  return jsonb_build_object(
    'profile',jsonb_build_object(
      'id',p.id,'first_name',p.first_name,'last_name',p.last_name,'birth_date',p.birth_date,
      'preferred_position',p.preferred_position,'preferred_positions',p.preferred_positions,
      'secondary_position',p.secondary_position,'preferred_foot',p.preferred_foot,
      'avatar_url',p.avatar_url,'base_rating',p.base_rating,'is_system_admin',p.is_system_admin,
      'lifecycle_status',p.lifecycle_status,'created_at',p.created_at,'archived_at',p.archived_at
    ),'summary',v_summary,'groups',v_groups
  );
end;
$$;
revoke all on function public.system_admin_user_detail(uuid) from public,anon;
grant execute on function public.system_admin_user_detail(uuid) to authenticated;

-- Convert existing vote totals and premature appearance counts in place. No
-- match, vote, rating, goal or attendance rows are changed or deleted.
do $$
declare member record;
begin
  for member in select distinct user_id from public.group_members loop
    perform public.refresh_player_public_stats(member.user_id);
  end loop;
end;
$$;

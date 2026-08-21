-- Keep ratings, MVP, goal and team-balance aggregates consistent.

-- Store the exact value used by a generation so the UI can display the same
-- balance calculation as the database algorithm.
alter table public.team_players
add column if not exists balance_rating_snapshot numeric(4,2) not null default 3
check (balance_rating_snapshot between 1 and 5);

update public.team_players tp
set balance_rating_snapshot=coalesce(
  (select mg.balance_rating from public.match_guests mg where mg.id=tp.guest_id),
  (select coalesce(round((avg(pr.overall_rating) filter (where rated_match.id is not null))::numeric,2),p.base_rating,3)
   from public.profiles p
   left join public.player_ratings pr on pr.rated_user_id=p.id
   left join public.matches rated_match on rated_match.id=pr.match_id
    and rated_match.group_id=(
      select current_match.group_id
      from public.teams current_team
      join public.matches current_match on current_match.id=current_team.match_id
      where current_team.id=tp.team_id
    )
   where p.id=tp.user_id
   group by p.base_rating),
  3
);

-- Refresh both the old and new recipient when an MVP vote or rating target is
-- changed. Previously the old recipient could retain a stale aggregate.
create or replace function public.refresh_stats_from_rating()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    perform public.refresh_player_public_stats(old.rated_user_id);
    return old;
  end if;
  if tg_op='UPDATE' and old.rated_user_id is distinct from new.rated_user_id then
    perform public.refresh_player_public_stats(old.rated_user_id);
  end if;
  perform public.refresh_player_public_stats(new.rated_user_id);
  return new;
end $$;

create or replace function public.refresh_stats_from_mvp()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    perform public.refresh_player_public_stats(old.voted_user_id);
    return old;
  end if;
  if tg_op='UPDATE' and old.voted_user_id is distinct from new.voted_user_id then
    perform public.refresh_player_public_stats(old.voted_user_id);
  end if;
  perform public.refresh_player_public_stats(new.voted_user_id);
  return new;
end $$;

revoke all on function public.refresh_stats_from_rating() from public,anon,authenticated;
revoke all on function public.refresh_stats_from_mvp() from public,anon,authenticated;

-- Monthly awards belong to the month in which the match was played, regardless
-- of when participants submitted their ratings.
create or replace function public.get_player_of_month(
  p_group_id uuid,
  p_month date default date_trunc('month',current_date)::date
)
returns table(user_id uuid,first_name text,last_name text,avg_rating numeric,rating_count bigint,mvp_count bigint,games_count bigint,score numeric)
language sql security definer set search_path=public stable as $$
 with ratings as(
  select pr.rated_user_id user_id,avg(pr.overall_rating)::numeric(4,2) avg_rating,count(*) rating_count
  from public.player_ratings pr join public.matches m on m.id=pr.match_id
  where m.group_id=p_group_id
   and m.match_date>=date_trunc('month',p_month)::date
   and m.match_date<(date_trunc('month',p_month)+interval '1 month')::date
  group by pr.rated_user_id
 ), mvps as(
  select mv.voted_user_id user_id,count(*) mvp_count
  from public.mvp_votes mv join public.matches m on m.id=mv.match_id
  where m.group_id=p_group_id
   and m.match_date>=date_trunc('month',p_month)::date
   and m.match_date<(date_trunc('month',p_month)+interval '1 month')::date
  group by mv.voted_user_id
 ), games as(
  select mr.user_id,count(*) games_count
  from public.match_registrations mr join public.matches m on m.id=mr.match_id
  where m.group_id=p_group_id and mr.registration_status='confirmed' and mr.attended=true
   and m.match_date>=date_trunc('month',p_month)::date
   and m.match_date<(date_trunc('month',p_month)+interval '1 month')::date
  group by mr.user_id
 )
 select p.id,p.first_name,p.last_name,coalesce(r.avg_rating,0),coalesce(r.rating_count,0),coalesce(v.mvp_count,0),coalesce(g.games_count,0),
  (coalesce(r.avg_rating,0)*20+coalesce(v.mvp_count,0)*8+coalesce(g.games_count,0)*2)::numeric(8,2) score
 from public.profiles p
 join public.group_members gm on gm.user_id=p.id and gm.group_id=p_group_id and gm.status='active'
 left join ratings r on r.user_id=p.id
 left join mvps v on v.user_id=p.id
 left join games g on g.user_id=p.id
 where public.is_group_member(p_group_id)
  and (coalesce(r.rating_count,0)>0 or coalesce(v.mvp_count,0)>0 or coalesce(g.games_count,0)>0)
 order by score desc,rating_count desc limit 1;
$$;
revoke all on function public.get_player_of_month(uuid,date) from public,anon;
grant execute on function public.get_player_of_month(uuid,date) to authenticated;

-- Cancelling a match invalidates every goal from that match, including goals
-- that had already been approved.
create or replace function public.reject_pending_goals_for_cancelled_match()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='cancelled' and old.status is distinct from new.status then
    update public.goal_events
    set status=case when status='approved' then 'cancelled'::public.goal_event_status else 'rejected'::public.goal_event_status end,
      reviewed_at=coalesce(reviewed_at,now()),
      cancelled_at=case when status='approved' then now() else cancelled_at end,
      cancellation_reason='match_cancelled'
    where match_id=new.id and status in ('pending','approved');
  end if;
  return new;
end $$;
revoke all on function public.reject_pending_goals_for_cancelled_match() from public,anon,authenticated;

-- Repair goals from matches cancelled before this correction.
update public.goal_events ge
set status=case when ge.status='approved' then 'cancelled'::public.goal_event_status else 'rejected'::public.goal_event_status end,
  reviewed_at=coalesce(ge.reviewed_at,now()),
  cancelled_at=case when ge.status='approved' then now() else ge.cancelled_at end,
  cancellation_reason='match_cancelled'
from public.matches m
where m.id=ge.match_id and m.status='cancelled' and ge.status in ('pending','approved');

-- Team balancing uses only ratings earned inside the current group. Guests use
-- their one-time estimate and never enter rating or career-stat tables.
create or replace function public.generate_balanced_teams(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_match public.matches;v_version int;v_team_ids uuid[];rec record;i int:=0;idx int;
  v_count int;v_team_count int;
  colors text[]:=array['red','blue','yellow','green'];
  names text[]:=array['האדומים','הכחולים','הצהובים','הירוקים'];
begin
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.has_group_permission(v_match.group_id,'generate_teams') then raise exception 'אין הרשאה ליצור קבוצות'; end if;
  if v_match.status<>'registration_closed' then raise exception 'יש לסגור את ההרשמה לפני יצירת הקבוצות'; end if;

  select
    (select count(*) from public.match_registrations where match_id=p_match_id and registration_status='confirmed')
    +(select count(*) from public.match_guests where match_id=p_match_id)
  into v_count;
  if v_count<2 then raise exception 'צריך לפחות שני משתתפים כדי ליצור שתי קבוצות'; end if;
  v_team_count:=greatest(2,least(4,v_match.team_count,v_count,
    greatest(2,ceil(v_count::numeric/greatest(v_match.team_size,1))::int)));

  select coalesce(max(generation_version),0)+1 into v_version from public.teams where match_id=p_match_id;
  v_team_ids:=array[]::uuid[];
  for idx in 1..v_team_count loop
    insert into public.teams(match_id,name,team_number,generation_version,color_key)
    values(p_match_id,names[idx],idx,v_version,colors[idx]) returning id into rec;
    v_team_ids:=array_append(v_team_ids,rec.id);
  end loop;

  for rec in
    select x.user_id,x.guest_id,x.rating,x.preferred_position
    from (
      select mr.user_id,null::uuid guest_id,
        coalesce((
          select avg(pr.overall_rating)
          from public.player_ratings pr
          join public.matches rated_match on rated_match.id=pr.match_id
          where pr.rated_user_id=mr.user_id and rated_match.group_id=v_match.group_id
        ),p.base_rating,3) rating,
        p.preferred_position
      from public.match_registrations mr
      join public.profiles p on p.id=mr.user_id
      where mr.match_id=p_match_id and mr.registration_status='confirmed'
      union all
      select null::uuid,mg.id,mg.balance_rating,mg.preferred_position
      from public.match_guests mg where mg.match_id=p_match_id
    ) x
    order by (x.preferred_position='goalkeeper') desc,x.rating desc,random()
  loop
    idx:=case when (i/v_team_count)::int%2=0 then (i%v_team_count)+1 else v_team_count-(i%v_team_count) end;
    insert into public.team_players(team_id,user_id,guest_id,assigned_position,is_goalkeeper,balance_rating_snapshot)
    values(v_team_ids[idx],rec.user_id,rec.guest_id,rec.preferred_position,rec.preferred_position='goalkeeper',rec.rating);
    i:=i+1;
  end loop;

  update public.matches set status='teams_published' where id=p_match_id;
  update public.teams set is_published=true where match_id=p_match_id and generation_version=v_version;
end $$;
revoke all on function public.generate_balanced_teams(uuid) from public,anon;
grant execute on function public.generate_balanced_teams(uuid) to authenticated;

-- Rebuild cached aggregates after repairing trigger behavior.
do $$ declare r record; begin
  for r in select distinct user_id from public.group_members loop
    perform public.refresh_player_public_stats(r.user_id);
  end loop;
end $$;

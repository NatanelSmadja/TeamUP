-- Secure ratings lifecycle and actual match attendance.

alter table public.match_registrations add column if not exists attended boolean not null default false;
alter table public.match_registrations add column if not exists attendance_marked_at timestamptz;
alter table public.match_registrations add column if not exists attendance_marked_by uuid references public.profiles(id) on delete set null;
alter table public.matches add column if not exists ratings_opened_at timestamptz;
alter table public.matches add column if not exists ratings_closes_at timestamptz;

-- Preserve historical behavior for matches whose ratings were already opened.
update public.match_registrations mr
set attended=true,attendance_marked_at=coalesce(attendance_marked_at,now())
from public.matches m
where m.id=mr.match_id and mr.registration_status='confirmed'
  and (m.status='completed' or m.ratings_open=true) and mr.attended=false;

create or replace function public.set_match_attendance(p_match_id uuid,p_user_id uuid default null,p_attended boolean default true)
returns void language plpgsql security definer set search_path=public as $$
declare m public.matches;v_count integer;
begin
 select * into m from public.matches where id=p_match_id for update;
 if not found then raise exception 'המשחק לא נמצא'; end if;
 if not public.has_group_permission(m.group_id,'open_ratings') then raise exception 'אין הרשאה לעדכן נוכחות'; end if;
 if m.ratings_open then raise exception 'יש לסגור את הדירוגים לפני שינוי נוכחות'; end if;
 update public.match_registrations
 set attended=p_attended,attendance_marked_at=now(),attendance_marked_by=(select auth.uid())
 where match_id=p_match_id and registration_status='confirmed'
   and (p_user_id is null or user_id=p_user_id);
 get diagnostics v_count=row_count;
 if p_user_id is not null and v_count=0 then raise exception 'השחקן אינו רשום כמשתתף מאושר'; end if;
end $$;
grant execute on function public.set_match_attendance(uuid,uuid,boolean) to authenticated;

create or replace function public.open_match_ratings(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare m public.matches;v_attended integer;v_end timestamp;
begin
 select * into m from public.matches where id=p_match_id for update;
 if not found then raise exception 'המשחק לא נמצא'; end if;
 if not public.has_group_permission(m.group_id,'open_ratings') then raise exception 'אין הרשאה'; end if;
 if m.status not in ('teams_published','completed') then raise exception 'יש לפרסם קבוצות לפני פתיחת דירוג'; end if;
 if not exists(select 1 from public.teams where match_id=p_match_id and is_published=true) then raise exception 'יש לפרסם קבוצות לפני פתיחת דירוג'; end if;
 if m.end_time is null then
  v_end:=m.match_date+m.start_time+interval '2 hours';
 elsif m.end_time<m.start_time then
  v_end:=m.match_date+m.end_time+interval '1 day';
 else
  v_end:=m.match_date+m.end_time;
 end if;
 if (clock_timestamp() at time zone 'Asia/Jerusalem')<v_end then raise exception 'ניתן לפתוח דירוג רק לאחר סיום המשחק'; end if;
 select count(*) into v_attended from public.match_registrations
 where match_id=p_match_id and registration_status='confirmed' and attended=true;
 if v_attended<2 then raise exception 'יש לסמן לפחות שני שחקנים שנכחו במשחק'; end if;
 update public.matches set ratings_open=true,status='completed',ratings_opened_at=now(),ratings_closes_at=now()+interval '7 days'
 where id=p_match_id;
end $$;
grant execute on function public.open_match_ratings(uuid) to authenticated;

create or replace function public.close_match_ratings(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_group uuid;
begin
 select group_id into v_group from public.matches where id=p_match_id;
 if v_group is null then raise exception 'המשחק לא נמצא'; end if;
 if not public.has_group_permission(v_group,'open_ratings') then raise exception 'אין הרשאה'; end if;
 update public.matches set ratings_open=false,ratings_closes_at=least(coalesce(ratings_closes_at,now()),now()) where id=p_match_id;
end $$;
grant execute on function public.close_match_ratings(uuid) to authenticated;

drop policy if exists "ratings insert participants" on public.player_ratings;
create policy "ratings insert attended participants" on public.player_ratings for insert to authenticated with check(
 rater_user_id=(select auth.uid()) and rater_user_id<>rated_user_id
 and exists(select 1 from public.matches m where m.id=player_ratings.match_id and m.ratings_open=true and (m.ratings_closes_at is null or m.ratings_closes_at>now()))
 and exists(select 1 from public.match_registrations mr where mr.match_id=player_ratings.match_id and mr.user_id=(select auth.uid()) and mr.registration_status='confirmed' and mr.attended=true)
 and exists(select 1 from public.match_registrations target where target.match_id=player_ratings.match_id and target.user_id=player_ratings.rated_user_id and target.registration_status='confirmed' and target.attended=true)
);

drop policy if exists "ratings update own" on public.player_ratings;
create policy "ratings update attended participants" on public.player_ratings for update to authenticated
using(rater_user_id=(select auth.uid()))
with check(
 rater_user_id=(select auth.uid()) and rater_user_id<>rated_user_id
 and exists(select 1 from public.matches m where m.id=player_ratings.match_id and m.ratings_open=true and (m.ratings_closes_at is null or m.ratings_closes_at>now()))
 and exists(select 1 from public.match_registrations mr where mr.match_id=player_ratings.match_id and mr.user_id=(select auth.uid()) and mr.registration_status='confirmed' and mr.attended=true)
 and exists(select 1 from public.match_registrations target where target.match_id=player_ratings.match_id and target.user_id=player_ratings.rated_user_id and target.registration_status='confirmed' and target.attended=true)
);

drop policy if exists "mvp vote insert" on public.mvp_votes;
create policy "mvp insert attended participants" on public.mvp_votes for insert to authenticated with check(
 voter_user_id=(select auth.uid()) and voter_user_id<>voted_user_id
 and exists(select 1 from public.matches m where m.id=mvp_votes.match_id and m.ratings_open=true and (m.ratings_closes_at is null or m.ratings_closes_at>now()))
 and exists(select 1 from public.match_registrations mr where mr.match_id=mvp_votes.match_id and mr.user_id=(select auth.uid()) and mr.registration_status='confirmed' and mr.attended=true)
 and exists(select 1 from public.match_registrations target where target.match_id=mvp_votes.match_id and target.user_id=mvp_votes.voted_user_id and target.registration_status='confirmed' and target.attended=true)
);

drop policy if exists "mvp update own" on public.mvp_votes;
create policy "mvp update attended participants" on public.mvp_votes for update to authenticated
using(voter_user_id=(select auth.uid()))
with check(
 voter_user_id=(select auth.uid()) and voter_user_id<>voted_user_id
 and exists(select 1 from public.matches m where m.id=mvp_votes.match_id and m.ratings_open=true and (m.ratings_closes_at is null or m.ratings_closes_at>now()))
 and exists(select 1 from public.match_registrations mr where mr.match_id=mvp_votes.match_id and mr.user_id=(select auth.uid()) and mr.registration_status='confirmed' and mr.attended=true)
 and exists(select 1 from public.match_registrations target where target.match_id=mvp_votes.match_id and target.user_id=mvp_votes.voted_user_id and target.registration_status='confirmed' and target.attended=true)
);

create or replace function public.submit_match_ratings(p_match_id uuid,p_ratings jsonb,p_mvp_user_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=(select auth.uid());m public.matches;r jsonb;v_target uuid;v_score integer;
begin
 if v_user is null then raise exception 'Not authenticated'; end if;
 select * into m from public.matches where id=p_match_id;
 if not found or not m.ratings_open or (m.ratings_closes_at is not null and m.ratings_closes_at<=now()) then raise exception 'חלון הדירוג סגור'; end if;
 if not exists(select 1 from public.match_registrations where match_id=p_match_id and user_id=v_user and registration_status='confirmed' and attended=true) then raise exception 'רק שחקן שנכח במשחק יכול לדרג'; end if;
 if p_ratings is null or jsonb_typeof(p_ratings)<>'array' then raise exception 'מבנה דירוגים לא תקין'; end if;
 if jsonb_array_length(p_ratings)=0 then raise exception 'יש לבחור לפחות דירוג אחד'; end if;
 for r in select value from jsonb_array_elements(p_ratings) loop
  v_target:=(r->>'user_id')::uuid;v_score:=(r->>'score')::integer;
  if v_target=v_user then raise exception 'לא ניתן לדרג את עצמך'; end if;
  if v_score not between 1 and 5 then raise exception 'ציון לא תקין'; end if;
  if not exists(select 1 from public.match_registrations where match_id=p_match_id and user_id=v_target and registration_status='confirmed' and attended=true) then raise exception 'ניתן לדרג רק שחקן שנכח במשחק'; end if;
  insert into public.player_ratings(match_id,rater_user_id,rated_user_id,overall_rating,teamwork_rating,attack_rating,defense_rating,effort_rating,sportsmanship_rating)
  values(p_match_id,v_user,v_target,v_score,v_score,v_score,v_score,v_score,v_score)
  on conflict(match_id,rater_user_id,rated_user_id) do update set overall_rating=excluded.overall_rating,teamwork_rating=excluded.teamwork_rating,attack_rating=excluded.attack_rating,defense_rating=excluded.defense_rating,effort_rating=excluded.effort_rating,sportsmanship_rating=excluded.sportsmanship_rating;
 end loop;
 if p_mvp_user_id is not null then
  if p_mvp_user_id=v_user then raise exception 'לא ניתן לבחור את עצמך ל־MVP'; end if;
  if not exists(select 1 from public.match_registrations where match_id=p_match_id and user_id=p_mvp_user_id and registration_status='confirmed' and attended=true) then raise exception 'ניתן לבחור ל־MVP רק שחקן שנכח במשחק'; end if;
  insert into public.mvp_votes(match_id,voter_user_id,voted_user_id) values(p_match_id,v_user,p_mvp_user_id)
  on conflict(match_id,voter_user_id) do update set voted_user_id=excluded.voted_user_id;
 end if;
end $$;
grant execute on function public.submit_match_ratings(uuid,jsonb,uuid) to authenticated;

create or replace function public.notify_ratings_opened() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.ratings_open=true and coalesce(old.ratings_open,false)=false then
  insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
  select mr.user_id,'ratings_open','הדירוג למשחק נפתח','אפשר לדרג עכשיו את שחקני המשחק ולבחור MVP','rating',new.id
  from public.match_registrations mr
  where mr.match_id=new.id and mr.registration_status='confirmed' and mr.attended=true;
 end if;
 return new;
end $$;

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
   (select count(*) from public.match_registrations mr join public.matches m on m.id=mr.match_id where mr.user_id=p_user_id and mr.registration_status='confirmed' and mr.attended=true and m.group_id=g.group_id),now()
  on conflict(group_id,user_id) do update set avg_rating=excluded.avg_rating,rating_count=excluded.rating_count,mvp_count=excluded.mvp_count,games_count=excluded.games_count,updated_at=now();
 end loop;
end $$;

create or replace function public.get_player_of_month(p_group_id uuid,p_month date default date_trunc('month',current_date)::date)
returns table(user_id uuid,first_name text,last_name text,avg_rating numeric,rating_count bigint,mvp_count bigint,games_count bigint,score numeric)
language sql security definer set search_path=public stable as $$
 with ratings as(
  select pr.rated_user_id user_id,avg(pr.overall_rating)::numeric(4,2) avg_rating,count(*) rating_count
  from public.player_ratings pr join public.matches m on m.id=pr.match_id
  where m.group_id=p_group_id and pr.created_at>=date_trunc('month',p_month) and pr.created_at<date_trunc('month',p_month)+interval '1 month'
  group by pr.rated_user_id
 ), mvps as(
  select mv.voted_user_id user_id,count(*) mvp_count from public.mvp_votes mv join public.matches m on m.id=mv.match_id
  where m.group_id=p_group_id and mv.created_at>=date_trunc('month',p_month) and mv.created_at<date_trunc('month',p_month)+interval '1 month' group by mv.voted_user_id
 ), games as(
  select mr.user_id,count(*) games_count from public.match_registrations mr join public.matches m on m.id=mr.match_id
  where m.group_id=p_group_id and mr.registration_status='confirmed' and mr.attended=true and m.match_date>=date_trunc('month',p_month)::date and m.match_date<(date_trunc('month',p_month)+interval '1 month')::date group by mr.user_id
 )
 select p.id,p.first_name,p.last_name,coalesce(r.avg_rating,0),coalesce(r.rating_count,0),coalesce(v.mvp_count,0),coalesce(g.games_count,0),
 (coalesce(r.avg_rating,0)*20+coalesce(v.mvp_count,0)*8+coalesce(g.games_count,0)*2)::numeric(8,2) score
 from public.profiles p join public.group_members gm on gm.user_id=p.id and gm.group_id=p_group_id and gm.status='active'
 left join ratings r on r.user_id=p.id left join mvps v on v.user_id=p.id left join games g on g.user_id=p.id
 where public.is_group_member(p_group_id)
 order by score desc,rating_count desc limit 1;
$$;
grant execute on function public.get_player_of_month(uuid,date) to authenticated;

-- Recalculate game counts after the attendance backfill.
do $$ declare r record; begin for r in select distinct user_id from public.group_members loop perform public.refresh_player_public_stats(r.user_id); end loop; end $$;

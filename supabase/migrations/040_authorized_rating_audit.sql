-- Authorized rating audit. Individual ballots remain hidden from ordinary
-- members; group admins, owners, system admins and explicitly delegated rating
-- auditors can inspect them through these security-definer RPCs.

insert into public.permissions(key,label)
values('view_rating_audit','צפייה בפירוט דירוגים')
on conflict(key) do update set label=excluded.label;

create or replace function public.get_group_rating_audit_matches(p_group_id uuid)
returns table(
  match_id uuid,
  title text,
  match_date date,
  status public.match_status,
  ratings_open boolean,
  rating_entries bigint,
  distinct_raters bigint,
  mvp_ballots bigint,
  attended_players bigint
)
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  if not (public.has_group_permission(p_group_id,'view_rating_audit') or public.is_system_admin()) then
    raise exception 'אין הרשאה לצפות בפירוט הדירוגים';
  end if;

  return query
  select m.id,m.title,m.match_date,m.status,m.ratings_open,
    (select count(*) from public.player_ratings pr where pr.match_id=m.id),
    (select count(distinct pr.rater_user_id) from public.player_ratings pr where pr.match_id=m.id),
    (select count(*) from public.mvp_votes mv where mv.match_id=m.id),
    (select count(*) from public.match_registrations mr where mr.match_id=m.id and mr.registration_status='confirmed' and mr.attended=true)
  from public.matches m
  where m.group_id=p_group_id
    and (m.status='completed' or m.ratings_open
      or exists(select 1 from public.player_ratings pr where pr.match_id=m.id)
      or exists(select 1 from public.mvp_votes mv where mv.match_id=m.id))
  order by m.match_date desc,m.start_time desc,m.created_at desc
  limit 40;
end;
$$;
revoke all on function public.get_group_rating_audit_matches(uuid) from public,anon;
grant execute on function public.get_group_rating_audit_matches(uuid) to authenticated;

create or replace function public.get_match_rating_audit(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_match public.matches;
  v_ratings jsonb;
  v_votes jsonb;
  v_attended integer;
begin
  select * into v_match from public.matches where id=p_match_id;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not (public.has_group_permission(v_match.group_id,'view_rating_audit') or public.is_system_admin()) then
    raise exception 'אין הרשאה לצפות בפירוט הדירוגים';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',pr.id,
    'rater_user_id',pr.rater_user_id,
    'rater_name',coalesce(nullif(trim(concat_ws(' ',rater.first_name,rater.last_name)),''),'שחקן'),
    'rated_user_id',pr.rated_user_id,
    'rated_name',coalesce(nullif(trim(concat_ws(' ',rated.first_name,rated.last_name)),''),'שחקן'),
    'overall_rating',pr.overall_rating,
    'teamwork_rating',pr.teamwork_rating,
    'attack_rating',pr.attack_rating,
    'defense_rating',pr.defense_rating,
    'effort_rating',pr.effort_rating,
    'sportsmanship_rating',pr.sportsmanship_rating,
    'created_at',pr.created_at
  ) order by rater.first_name,rater.last_name,rated.first_name,rated.last_name),'[]'::jsonb)
  into v_ratings
  from public.player_ratings pr
  join public.profiles rater on rater.id=pr.rater_user_id
  join public.profiles rated on rated.id=pr.rated_user_id
  where pr.match_id=p_match_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',mv.id,
    'voter_user_id',mv.voter_user_id,
    'voter_name',coalesce(nullif(trim(concat_ws(' ',voter.first_name,voter.last_name)),''),'שחקן'),
    'voted_user_id',mv.voted_user_id,
    'voted_name',coalesce(nullif(trim(concat_ws(' ',voted.first_name,voted.last_name)),''),'שחקן'),
    'created_at',mv.created_at
  ) order by voter.first_name,voter.last_name),'[]'::jsonb)
  into v_votes
  from public.mvp_votes mv
  join public.profiles voter on voter.id=mv.voter_user_id
  join public.profiles voted on voted.id=mv.voted_user_id
  where mv.match_id=p_match_id;

  select count(*) into v_attended
  from public.match_registrations mr
  where mr.match_id=p_match_id and mr.registration_status='confirmed' and mr.attended=true;

  return jsonb_build_object(
    'match',jsonb_build_object(
      'id',v_match.id,'title',v_match.title,'match_date',v_match.match_date,
      'status',v_match.status,'ratings_open',v_match.ratings_open,
      'ratings_closes_at',v_match.ratings_closes_at
    ),
    'attended_count',v_attended,
    'ratings',v_ratings,
    'mvp_votes',v_votes
  );
end;
$$;
revoke all on function public.get_match_rating_audit(uuid) from public,anon;
grant execute on function public.get_match_rating_audit(uuid) to authenticated;

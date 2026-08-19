-- Finalize the match lifecycle and protect published results from late team edits.

create or replace function public.protect_finalized_team_player_update()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_match public.matches;
begin
  select m.* into v_match
  from public.teams t
  join public.matches m on m.id=t.match_id
  where t.id=old.team_id;

  if v_match.ratings_open or v_match.status in ('completed','cancelled')
     or (clock_timestamp() at time zone 'Asia/Jerusalem') >= (v_match.match_date+v_match.start_time) then
    raise exception 'לא ניתן לערוך את חלוקת הקבוצות לאחר תחילת המשחק';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_finalized_team_player_update() from public,anon,authenticated;

drop trigger if exists protect_finalized_team_player_update on public.team_players;
create trigger protect_finalized_team_player_update
before update on public.team_players
for each row execute function public.protect_finalized_team_player_update();

create or replace function public.regenerate_balanced_teams(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_match public.matches;
begin
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.has_group_permission(v_match.group_id,'generate_teams') then raise exception 'אין הרשאה ליצור חלוקה חדשה'; end if;
  if v_match.ratings_open or v_match.status in ('completed','cancelled')
     or (clock_timestamp() at time zone 'Asia/Jerusalem') >= (v_match.match_date+v_match.start_time) then
    raise exception 'לא ניתן ליצור חלוקה חדשה לאחר תחילת המשחק';
  end if;
  if v_match.status<>'teams_published' then raise exception 'ניתן ליצור חלוקה מחדש רק לאחר פרסום קבוצות'; end if;

  update public.teams set is_published=false where match_id=p_match_id and is_published=true;
  update public.matches set status='registration_closed' where id=p_match_id;
  perform public.generate_balanced_teams(p_match_id);
end;
$$;
revoke all on function public.regenerate_balanced_teams(uuid) from public,anon;
grant execute on function public.regenerate_balanced_teams(uuid) to authenticated;

create or replace function public.set_match_attendance(
  p_match_id uuid,
  p_user_id uuid default null,
  p_attended boolean default true
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare m public.matches;v_count integer;v_user uuid:=(select auth.uid());
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if m.created_by<>v_user and not public.has_group_permission(m.group_id,'open_ratings') then
    raise exception 'רק יוצר המשחק או מנהל מורשה יכולים לעדכן נוכחות';
  end if;
  if m.ratings_open or m.status in ('completed','cancelled') then raise exception 'לא ניתן לשנות נוכחות לאחר סיום או ביטול המשחק'; end if;
  update public.match_registrations
  set attended=p_attended,attendance_marked_at=now(),attendance_marked_by=v_user
  where match_id=p_match_id and registration_status='confirmed'
    and (p_user_id is null or user_id=p_user_id);
  get diagnostics v_count=row_count;
  if p_user_id is not null and v_count=0 then raise exception 'השחקן אינו רשום כמשתתף מאושר'; end if;
end;
$$;
revoke all on function public.set_match_attendance(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_match_attendance(uuid,uuid,boolean) to authenticated;

create or replace function public.complete_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  m public.matches;
  v_end timestamp;
  v_attended integer;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not (public.is_match_result_manager(p_match_id) or public.has_group_permission(m.group_id,'open_ratings') or public.is_system_admin()) then
    raise exception 'אין הרשאה לסיים את המשחק';
  end if;
  if m.ratings_open then raise exception 'הדירוג כבר פתוח'; end if;
  if m.status='completed' then return; end if;
  if m.status<>'teams_published' then raise exception 'יש לסגור הרשמה ולפרסם קבוצות לפני סיום המשחק'; end if;

  v_end:=case
    when m.end_time is null then m.match_date+m.start_time+interval '2 hours'
    when m.end_time<m.start_time then m.match_date+m.end_time+interval '1 day'
    else m.match_date+m.end_time
  end;
  if (clock_timestamp() at time zone 'Asia/Jerusalem')<v_end then raise exception 'ניתן לסיים את המשחק רק לאחר שעת הסיום'; end if;

  select count(*) into v_attended from public.match_registrations
  where match_id=p_match_id and registration_status='confirmed' and attended=true;
  if v_attended<2 then raise exception 'יש לסמן לפחות שני שחקנים שנכחו לפני סיום המשחק'; end if;
  if exists(select 1 from public.goal_events where match_id=p_match_id and status='pending') then
    raise exception 'יש לאשר או לדחות את כל דיווחי השערים לפני סיום המשחק';
  end if;

  update public.matches set status='completed' where id=p_match_id;
  perform public.log_group_audit(m.group_id,'match.completed','match',p_match_id,to_jsonb(m),jsonb_build_object('status','completed'));
end;
$$;
revoke all on function public.complete_match(uuid) from public,anon;
grant execute on function public.complete_match(uuid) to authenticated;

create or replace function public.open_match_ratings(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare m public.matches;v_attended integer;v_end timestamp;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.has_group_permission(m.group_id,'open_ratings') then raise exception 'אין הרשאה'; end if;
  if m.status<>'completed' then raise exception 'יש לסיים את המשחק לפני פתיחת הדירוג'; end if;
  if not exists(select 1 from public.teams where match_id=p_match_id and is_published=true) then raise exception 'יש לפרסם קבוצות לפני פתיחת דירוג'; end if;
  if exists(select 1 from public.goal_events where match_id=p_match_id and status='pending') then raise exception 'יש לטפל בכל דיווחי השערים לפני פתיחת הדירוג'; end if;

  v_end:=case
    when m.end_time is null then m.match_date+m.start_time+interval '2 hours'
    when m.end_time<m.start_time then m.match_date+m.end_time+interval '1 day'
    else m.match_date+m.end_time
  end;
  if (clock_timestamp() at time zone 'Asia/Jerusalem')<v_end then raise exception 'ניתן לפתוח דירוג רק לאחר סיום המשחק'; end if;
  select count(*) into v_attended from public.match_registrations
  where match_id=p_match_id and registration_status='confirmed' and attended=true;
  if v_attended<2 then raise exception 'יש לסמן לפחות שני שחקנים שנכחו במשחק'; end if;

  update public.matches
  set ratings_open=true,ratings_opened_at=now(),ratings_closes_at=now()+interval '7 days'
  where id=p_match_id;
end;
$$;
revoke all on function public.open_match_ratings(uuid) from public,anon;
grant execute on function public.open_match_ratings(uuid) to authenticated;

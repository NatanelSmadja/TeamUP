-- Replace a one-time guest with a registered group member without changing the
-- occupied match slot or the published team assignment. Only registration
-- managers and system administrators may perform this identity handoff.

create or replace function public.link_match_guest_to_user(
  p_match_id uuid,
  p_guest_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_match public.matches;
  v_guest public.match_guests;
  v_registration public.match_registrations;
  v_player_name text;
begin
  if v_actor is null then raise exception 'יש להתחבר מחדש למערכת'; end if;

  select * into v_match
  from public.matches
  where id=p_match_id
  for update;

  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not (public.has_group_permission(v_match.group_id,'manage_registrations') or public.is_system_admin()) then
    raise exception 'רק מנהל בעל הרשאה לניהול הרשמות יכול להמיר אורח לשחקן';
  end if;
  if v_match.ratings_open or v_match.status in ('completed','cancelled') then
    raise exception 'לא ניתן להמיר אורח לאחר סיום המשחק או פתיחת הדירוג';
  end if;
  if v_match.status not in ('registration_open','registration_closed','teams_published') then
    raise exception 'ניתן להמיר אורח רק במשחק פעיל';
  end if;

  select * into v_guest
  from public.match_guests
  where id=p_guest_id and match_id=p_match_id
  for update;
  if not found then raise exception 'השחקן האורח לא נמצא'; end if;

  if not exists(
    select 1 from public.group_members gm
    where gm.group_id=v_match.group_id and gm.user_id=p_user_id and gm.status='active'
  ) then
    raise exception 'ניתן לקשר את האורח רק לשחקן פעיל בקבוצה';
  end if;

  select * into v_registration
  from public.match_registrations
  where match_id=p_match_id and user_id=p_user_id
  for update;

  if v_registration.registration_status='confirmed' then
    raise exception 'השחקן כבר רשום ברשימה הראשית של המשחק';
  end if;
  if exists(
    select 1
    from public.team_players tp
    join public.teams t on t.id=tp.team_id
    where t.match_id=p_match_id and t.is_published and tp.user_id=p_user_id
  ) then
    raise exception 'השחקן כבר מופיע בחלוקת הקבוצות';
  end if;

  -- A single update preserves the participant constraint. The guest's rating
  -- snapshot and team stay unchanged, while all future match activity uses the
  -- registered user id.
  update public.team_players tp
  set user_id=p_user_id,guest_id=null
  where tp.guest_id=p_guest_id
    and exists(
      select 1 from public.teams t
      where t.id=tp.team_id and t.match_id=p_match_id
    );

  -- Delete the guest before confirming the registration so capacity remains a
  -- one-for-one replacement and the capacity trigger cannot move the user back
  -- to the waitlist.
  delete from public.match_guests where id=p_guest_id;

  insert into public.match_registrations(
    match_id,user_id,response,registration_status,queue_position,registered_at,
    promoted_at,cancelled_at,attended,attendance_marked_at,attendance_marked_by
  ) values (
    p_match_id,p_user_id,'attending','confirmed',null,now(),
    case when v_registration.registration_status='waitlisted' then now() else null end,
    null,v_guest.attended,
    case when v_guest.attended then coalesce(v_guest.attendance_marked_at,now()) else null end,
    case when v_guest.attended then coalesce(v_guest.attendance_marked_by,v_actor) else null end
  )
  on conflict(match_id,user_id) do update set
    response='attending',registration_status='confirmed',queue_position=null,
    promoted_at=case when public.match_registrations.registration_status='waitlisted' then now() else public.match_registrations.promoted_at end,
    cancelled_at=null,attended=excluded.attended,
    attendance_marked_at=excluded.attendance_marked_at,
    attendance_marked_by=excluded.attendance_marked_by;

  with ranked as (
    select id,row_number() over(order by registered_at,id) rn
    from public.match_registrations
    where match_id=p_match_id and registration_status='waitlisted'
  )
  update public.match_registrations mr
  set queue_position=ranked.rn
  from ranked where mr.id=ranked.id;

  select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'שחקן')
  into v_player_name from public.profiles where id=p_user_id;

  insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
  values(
    p_user_id,'match_guest_linked','שובצת למשחק',
    'מנהל הקבוצה קישר את המשתמש שלך למקום של '||v_guest.display_name||' במשחק '||v_match.title,
    'match',p_match_id
  );

  perform public.log_group_audit(
    v_match.group_id,'match.guest_linked','match_guest',p_guest_id,
    to_jsonb(v_guest),
    jsonb_build_object('user_id',p_user_id,'player_name',v_player_name,'registration_status','confirmed')
  );

  return jsonb_build_object(
    'guest_name',v_guest.display_name,
    'player_name',v_player_name,
    'user_id',p_user_id,
    'team_preserved',true
  );
end;
$$;

revoke all on function public.link_match_guest_to_user(uuid,uuid,uuid) from public,anon;
grant execute on function public.link_match_guest_to_user(uuid,uuid,uuid) to authenticated;

-- Let group registration managers and system administrators maintain a match
-- roster without bypassing capacity, waitlist, notification or audit rules.

create or replace function public.get_member_match_details(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_match public.matches;v_user uuid:=(select auth.uid());v_registrations jsonb;v_teams jsonb;
begin
  if v_user is null then raise exception 'יש להתחבר מחדש למערכת'; end if;
  select * into v_match from public.matches where id=p_match_id;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.is_system_admin() and not exists(
    select 1 from public.group_members gm
    where gm.group_id=v_match.group_id and gm.user_id=v_user and gm.status='active'
  ) then raise exception 'אין לך גישה למשחק הזה'; end if;

  select coalesce(jsonb_agg(to_jsonb(mr)||jsonb_build_object('profiles',to_jsonb(p)) order by mr.registered_at),'[]'::jsonb)
  into v_registrations
  from public.match_registrations mr
  join public.profiles p on p.id=mr.user_id
  where mr.match_id=p_match_id;

  select coalesce(jsonb_agg(
    to_jsonb(t)||jsonb_build_object('team_players',coalesce((
      select jsonb_agg(to_jsonb(tp)||jsonb_build_object('profiles',to_jsonb(p)) order by tp.id)
      from public.team_players tp
      join public.profiles p on p.id=tp.user_id
      where tp.team_id=t.id
    ),'[]'::jsonb)) order by t.generation_version desc,t.team_number
  ),'[]'::jsonb)
  into v_teams
  from public.teams t
  where t.match_id=p_match_id and t.is_published=true;

  return jsonb_build_object('match',to_jsonb(v_match),'regs',v_registrations,'teams',v_teams);
end;
$$;
revoke all on function public.get_member_match_details(uuid) from public,anon;
grant execute on function public.get_member_match_details(uuid) to authenticated;

create or replace function public.get_match_registration_candidates(p_match_id uuid)
returns table(user_id uuid,profiles jsonb)
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_group uuid;
begin
  select group_id into v_group from public.matches where id=p_match_id;
  if v_group is null then raise exception 'המשחק לא נמצא'; end if;
  if not (public.has_group_permission(v_group,'manage_registrations') or public.is_system_admin()) then
    raise exception 'אין הרשאה לנהל את רשימת המשחק';
  end if;
  return query
  select gm.user_id,to_jsonb(p)
  from public.group_members gm
  join public.profiles p on p.id=gm.user_id
  where gm.group_id=v_group and gm.status='active'
  order by p.first_name,p.last_name,gm.joined_at;
end;
$$;
revoke all on function public.get_match_registration_candidates(uuid) from public,anon;
grant execute on function public.get_match_registration_candidates(uuid) to authenticated;

create or replace function public.manage_match_registration(
  p_match_id uuid,
  p_user_id uuid,
  p_attending boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_match public.matches;
  v_member public.group_members;
  v_registration public.match_registrations;
  v_next public.match_registrations;
  v_confirmed integer;
  v_status public.registration_status;
  v_name text;
  v_changed boolean := false;
begin
  if v_actor is null then raise exception 'יש להתחבר מחדש למערכת'; end if;

  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not (public.has_group_permission(v_match.group_id,'manage_registrations') or public.is_system_admin()) then
    raise exception 'אין הרשאה לנהל את רשימת המשחק';
  end if;
  if v_match.ratings_open or v_match.status in ('teams_published','completed') then
    raise exception 'לא ניתן לשנות את הרשימה אחרי פרסום הקבוצות או פתיחת הדירוג';
  end if;
  if v_match.status not in ('registration_open','registration_closed') then
    raise exception 'ניתן לנהל שחקנים רק לאחר פתיחת ההרשמה ולפני פרסום הקבוצות';
  end if;

  select * into v_member
  from public.group_members
  where group_id=v_match.group_id and user_id=p_user_id and status='active';
  if not found then raise exception 'ניתן להוסיף רק שחקן פעיל בקבוצה'; end if;

  select * into v_registration
  from public.match_registrations
  where match_id=p_match_id and user_id=p_user_id
  for update;

  select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'שחקן') into v_name
  from public.profiles where id=p_user_id;

  if p_attending then
    if v_registration.id is null or v_registration.registration_status not in ('confirmed','waitlisted') or v_registration.response<>'attending' then
      select count(*) into v_confirmed
      from public.match_registrations
      where match_id=p_match_id and registration_status='confirmed' and user_id<>p_user_id;
      v_status := case when v_confirmed<v_match.capacity then 'confirmed' else 'waitlisted' end;

      insert into public.match_registrations(
        match_id,user_id,response,registration_status,queue_position,registered_at,
        promoted_at,cancelled_at,attended,attendance_marked_at,attendance_marked_by
      ) values (
        p_match_id,p_user_id,'attending',v_status,null,now(),
        null,null,false,null,null
      )
      on conflict(match_id,user_id) do update set
        response='attending',registration_status=v_status,queue_position=null,registered_at=now(),
        promoted_at=null,cancelled_at=null,attended=false,attendance_marked_at=null,attendance_marked_by=null;
      v_changed := true;

      insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
      values(
        p_user_id,'match_registration_managed',
        case when v_status='confirmed' then 'נוספת למשחק' else 'נוספת לרשימת ההמתנה' end,
        case when v_status='confirmed' then 'מנהל הקבוצה הוסיף אותך לרשימה של ' else 'מנהל הקבוצה הוסיף אותך לרשימת ההמתנה של ' end||v_match.title,
        'match',p_match_id
      );
    else
      v_status := v_registration.registration_status;
    end if;
  else
    v_status := coalesce(v_registration.registration_status,'cancelled'::public.registration_status);
    if v_registration.registration_status in ('confirmed','waitlisted') and v_registration.response='attending' then
      update public.match_registrations
      set response='unavailable',registration_status='removed',queue_position=null,cancelled_at=now(),
          attended=false,attendance_marked_at=null,attendance_marked_by=null
      where match_id=p_match_id and user_id=p_user_id;
      v_changed := true;

      insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
      values(p_user_id,'match_registration_managed','הוסרת מרשימת המשחק','מנהל הקבוצה הסיר אותך מהרשימה של '||v_match.title,'match',p_match_id);

      if v_status='confirmed' and v_match.auto_promote_waitlist then
        select * into v_next
        from public.match_registrations
        where match_id=p_match_id and registration_status='waitlisted'
        order by registered_at
        for update skip locked limit 1;
        if found then
          update public.match_registrations
          set registration_status='confirmed',promoted_at=now(),queue_position=null
          where id=v_next.id;
          insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
          values(v_next.user_id,'waitlist_promoted','נכנסת למשחק','התפנה מקום ונכנסת אוטומטית לרשימה הראשית','match',p_match_id);
        end if;
      end if;
    end if;
  end if;

  with ranked as (
    select id,row_number() over(order by registered_at,id) rn
    from public.match_registrations
    where match_id=p_match_id and registration_status='waitlisted'
  )
  update public.match_registrations mr set queue_position=ranked.rn
  from ranked where mr.id=ranked.id;

  if v_changed then
    perform public.log_group_audit(
      v_match.group_id,
      case when p_attending then 'match.registration_added' else 'match.registration_removed' end,
      'match_registration',p_match_id,
      jsonb_build_object('user_id',p_user_id,'status',v_registration.registration_status),
      jsonb_build_object('user_id',p_user_id,'status',case when p_attending then v_status::text else 'removed' end)
    );
  end if;

  return jsonb_build_object(
    'changed',v_changed,
    'status',case when p_attending then v_status::text else 'removed' end,
    'player_name',v_name
  );
end;
$$;

revoke all on function public.manage_match_registration(uuid,uuid,boolean) from public,anon;
grant execute on function public.manage_match_registration(uuid,uuid,boolean) to authenticated;

-- A player cancelling from the waitlist must not promote another waitlisted
-- player while the confirmed roster is still full.
create or replace function public.respond_to_match(p_match_id uuid,p_response public.registration_response)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=(select auth.uid());v_match public.matches;v_count int;
  v_status public.registration_status;v_next public.match_registrations;
  v_old_response public.registration_response;v_old_status public.registration_status;v_name text;
begin
  if v_user is null then raise exception 'יש להתחבר מחדש למערכת'; end if;
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not exists(select 1 from public.group_members gm where gm.group_id=v_match.group_id and gm.user_id=v_user and gm.status='active') then
    raise exception 'רק חבר פעיל בקבוצה יכול להירשם למשחק';
  end if;
  if v_match.status<>'registration_open' then raise exception 'ההרשמה למשחק סגורה'; end if;

  select response,registration_status into v_old_response,v_old_status
  from public.match_registrations where match_id=p_match_id and user_id=v_user;
  select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'שחקן') into v_name
  from public.profiles where id=v_user;

  if p_response='attending' then
    select count(*) into v_count from public.match_registrations
    where match_id=p_match_id and registration_status='confirmed' and user_id<>v_user;
    v_status:=case when v_count<v_match.capacity then 'confirmed' else 'waitlisted' end;
    insert into public.match_registrations(match_id,user_id,response,registration_status,queue_position,registered_at,cancelled_at,attended,attendance_marked_at,attendance_marked_by)
    values(p_match_id,v_user,'attending',v_status,null,now(),null,false,null,null)
    on conflict(match_id,user_id) do update set
      response='attending',registration_status=v_status,queue_position=null,
      registered_at=now(),cancelled_at=null,attended=false,attendance_marked_at=null,attendance_marked_by=null;

    if coalesce(v_old_response,'no_response')<>'attending' or v_old_status not in ('confirmed','waitlisted') then
      perform public.notify_group_managers(
        v_match.group_id,'match_registration_added',v_name||' נרשם למשחק',
        case when v_status='waitlisted' then 'השחקן נכנס לרשימת ההמתנה של ' else 'השחקן הצטרף אל ' end||v_match.title,
        'match',v_match.id,array['manage_registrations','create_match','view_admin_alerts'],v_user
      );
    end if;
  else
    update public.match_registrations
    set response='unavailable',registration_status='cancelled',cancelled_at=now(),queue_position=null,
      attended=false,attendance_marked_at=null,attendance_marked_by=null
    where match_id=p_match_id and user_id=v_user;
    if not found then
      insert into public.match_registrations(match_id,user_id,response,registration_status,cancelled_at)
      values(p_match_id,v_user,'unavailable','cancelled',now());
    end if;

    if v_old_response='attending' and v_old_status in ('confirmed','waitlisted') then
      perform public.notify_group_managers(
        v_match.group_id,'match_registration_cancelled',v_name||' ביטל הגעה',
        'השחקן ביטל את ההרשמה ל־'||v_match.title,
        'match',v_match.id,array['manage_registrations','create_match','view_admin_alerts'],v_user
      );
    end if;

    if v_old_status='confirmed' and v_match.auto_promote_waitlist then
      select * into v_next from public.match_registrations
      where match_id=p_match_id and registration_status='waitlisted'
      order by registered_at for update skip locked limit 1;
      if found then
        update public.match_registrations set registration_status='confirmed',promoted_at=now(),queue_position=null where id=v_next.id;
        insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
        values(v_next.user_id,'waitlist_promoted','נכנסת למשחק','התפנה מקום ונכנסת אוטומטית לרשימה הראשית','match',p_match_id);
      end if;
    end if;
  end if;

  with ranked as(
    select id,row_number() over(order by registered_at,id) rn
    from public.match_registrations where match_id=p_match_id and registration_status='waitlisted'
  )
  update public.match_registrations mr set queue_position=ranked.rn
  from ranked where mr.id=ranked.id;
end $$;
revoke all on function public.respond_to_match(uuid,public.registration_response) from public,anon;
grant execute on function public.respond_to_match(uuid,public.registration_response) to authenticated;

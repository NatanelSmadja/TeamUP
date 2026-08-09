-- Give every active group member one secure source for match details and
-- registration, without relying on several independently-filtered RLS reads.

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
 if not exists(
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
end $$;

revoke all on function public.get_member_match_details(uuid) from public,anon;
grant execute on function public.get_member_match_details(uuid) to authenticated;

create or replace function public.respond_to_match(p_match_id uuid,p_response public.registration_response)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_user uuid:=(select auth.uid());v_match public.matches;v_count int;v_status public.registration_status;v_next public.match_registrations;
begin
 if v_user is null then raise exception 'יש להתחבר מחדש למערכת'; end if;
 select * into v_match from public.matches where id=p_match_id for update;
 if not found then raise exception 'המשחק לא נמצא'; end if;
 if not exists(
  select 1 from public.group_members gm
  where gm.group_id=v_match.group_id and gm.user_id=v_user and gm.status='active'
 ) then raise exception 'רק חבר פעיל בקבוצה יכול להירשם למשחק'; end if;
 if v_match.status<>'registration_open' then raise exception 'ההרשמה למשחק סגורה'; end if;

 if p_response='attending' then
  select count(*) into v_count from public.match_registrations
  where match_id=p_match_id and registration_status='confirmed';
  v_status:=case when v_count<v_match.capacity then 'confirmed' else 'waitlisted' end;
  insert into public.match_registrations(match_id,user_id,response,registration_status,queue_position,registered_at,cancelled_at,attended,attendance_marked_at,attendance_marked_by)
  values(p_match_id,v_user,'attending',v_status,case when v_status='waitlisted' then v_count-v_match.capacity+1 else null end,now(),null,false,null,null)
  on conflict(match_id,user_id) do update set
   response='attending',registration_status=v_status,queue_position=excluded.queue_position,
   registered_at=now(),cancelled_at=null,attended=false,attendance_marked_at=null,attendance_marked_by=null;
 else
  update public.match_registrations set response='unavailable',registration_status='cancelled',cancelled_at=now(),queue_position=null,attended=false,attendance_marked_at=null,attendance_marked_by=null
  where match_id=p_match_id and user_id=v_user;
  if not found then
   insert into public.match_registrations(match_id,user_id,response,registration_status,cancelled_at)
   values(p_match_id,v_user,'unavailable','cancelled',now());
  end if;
  if v_match.auto_promote_waitlist then
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
  select id,row_number() over(order by registered_at) rn
  from public.match_registrations where match_id=p_match_id and registration_status='waitlisted'
 )
 update public.match_registrations mr set queue_position=ranked.rn
 from ranked where mr.id=ranked.id;
end $$;

revoke all on function public.respond_to_match(uuid,public.registration_response) from public,anon;
grant execute on function public.respond_to_match(uuid,public.registration_response) to authenticated;


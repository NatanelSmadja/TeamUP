-- Make the match lifecycle consistent for small games and match creators.

create or replace function public.generate_balanced_teams(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
 v_match public.matches;v_version int;v_team_ids uuid[];rec record;i int:=0;idx int;
 v_count int;v_team_count int;
 colors text[]:=array['red','blue','yellow','green'];
 names text[]:=array['האדומים','הכחולים','הצהובים','הירוקים'];
begin
 select * into v_match from public.matches where id=p_match_id;
 if not found then raise exception 'המשחק לא נמצא'; end if;
 if not public.has_group_permission(v_match.group_id,'generate_teams') then raise exception 'אין הרשאה ליצור קבוצות'; end if;
 if v_match.status<>'registration_closed' then raise exception 'יש לסגור את ההרשמה לפני יצירת הקבוצות'; end if;

 select count(*) into v_count from public.match_registrations
 where match_id=p_match_id and registration_status='confirmed';
 if v_count<2 then raise exception 'צריך לפחות שני שחקנים כדי ליצור שתי קבוצות'; end if;

 -- Never create an empty team, and keep the current four-color UI limit.
 v_team_count:=greatest(2,least(4,v_match.team_count,v_count,
  greatest(2,round(v_count::numeric/greatest(v_match.team_size,1))::int)));
 select coalesce(max(generation_version),0)+1 into v_version from public.teams where match_id=p_match_id;
 v_team_ids:=array[]::uuid[];

 for idx in 1..v_team_count loop
  insert into public.teams(match_id,name,team_number,generation_version,color_key)
  values(p_match_id,names[idx],idx,v_version,colors[idx]) returning id into rec;
  v_team_ids:=array_append(v_team_ids,rec.id);
 end loop;

 for rec in
  select mr.user_id,coalesce(avg(pr.overall_rating),p.base_rating) rating,p.preferred_position
  from public.match_registrations mr
  join public.profiles p on p.id=mr.user_id
  left join public.player_ratings pr on pr.rated_user_id=mr.user_id
  where mr.match_id=p_match_id and mr.registration_status='confirmed'
  group by mr.user_id,p.base_rating,p.preferred_position
  order by (p.preferred_position='goalkeeper') desc,rating desc,random()
 loop
  idx:=case when (i/v_team_count)::int%2=0 then (i%v_team_count)+1 else v_team_count-(i%v_team_count) end;
  insert into public.team_players(team_id,user_id,assigned_position,is_goalkeeper)
  values(v_team_ids[idx],rec.user_id,rec.preferred_position,rec.preferred_position='goalkeeper');
  i:=i+1;
 end loop;

 update public.matches set status='teams_published',team_count=v_team_count where id=p_match_id;
 update public.teams set is_published=true where match_id=p_match_id and generation_version=v_version;
end $$;

revoke all on function public.generate_balanced_teams(uuid) from public,anon;
grant execute on function public.generate_balanced_teams(uuid) to authenticated;

create or replace function public.set_match_attendance(p_match_id uuid,p_user_id uuid default null,p_attended boolean default true)
returns void language plpgsql security definer set search_path=public as $$
declare m public.matches;v_count integer;v_user uuid:=(select auth.uid());
begin
 select * into m from public.matches where id=p_match_id for update;
 if not found then raise exception 'המשחק לא נמצא'; end if;
 if m.created_by<>v_user and not public.has_group_permission(m.group_id,'open_ratings') then
  raise exception 'רק יוצר המשחק או מנהל מורשה יכולים לעדכן נוכחות';
 end if;
 if m.ratings_open then raise exception 'יש לסגור את הדירוגים לפני שינוי נוכחות'; end if;
 update public.match_registrations
 set attended=p_attended,attendance_marked_at=now(),attendance_marked_by=v_user
 where match_id=p_match_id and registration_status='confirmed'
  and (p_user_id is null or user_id=p_user_id);
 get diagnostics v_count=row_count;
 if p_user_id is not null and v_count=0 then raise exception 'השחקן אינו רשום כמשתתף מאושר'; end if;
end $$;

revoke all on function public.set_match_attendance(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_match_attendance(uuid,uuid,boolean) to authenticated;


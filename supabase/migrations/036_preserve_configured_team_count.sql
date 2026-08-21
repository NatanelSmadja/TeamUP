-- Keep the configured team count stable across temporary small rosters.
-- Migration 026 (and consequently 035) stored the effective generated count
-- back into matches.team_count, so a two-team generation could permanently
-- replace a three-team configuration.

-- Repair active matches where capacity/team size clearly indicates that a
-- larger configured team count was overwritten by an earlier generation.
update public.matches
set team_count=least(4,capacity/team_size)
where status in ('draft','registration_open','registration_closed','teams_published')
  and capacity%team_size=0
  and capacity/team_size between 2 and 4
  and team_count<capacity/team_size;

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

  -- Use no more than the configured number of teams, create enough teams so
  -- the requested team size is not exceeded, and never create an empty team.
  v_team_count:=greatest(2,least(
    4,
    v_match.team_count,
    v_count,
    greatest(2,ceil(v_count::numeric/greatest(v_match.team_size,1))::int)
  ));

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
      select mr.user_id,null::uuid guest_id,coalesce(avg(pr.overall_rating),p.base_rating) rating,p.preferred_position
      from public.match_registrations mr join public.profiles p on p.id=mr.user_id
      left join public.player_ratings pr on pr.rated_user_id=mr.user_id
      where mr.match_id=p_match_id and mr.registration_status='confirmed'
      group by mr.user_id,p.base_rating,p.preferred_position
      union all
      select null::uuid,mg.id,mg.balance_rating,mg.preferred_position
      from public.match_guests mg where mg.match_id=p_match_id
    ) x
    order by (x.preferred_position='goalkeeper') desc,x.rating desc,random()
  loop
    idx:=case when (i/v_team_count)::int%2=0 then (i%v_team_count)+1 else v_team_count-(i%v_team_count) end;
    insert into public.team_players(team_id,user_id,guest_id,assigned_position,is_goalkeeper)
    values(v_team_ids[idx],rec.user_id,rec.guest_id,rec.preferred_position,rec.preferred_position='goalkeeper');
    i:=i+1;
  end loop;

  -- Do not write v_team_count back to matches.team_count. It is the effective
  -- count for this generation, while matches.team_count is the user's setting.
  update public.matches set status='teams_published' where id=p_match_id;
  update public.teams set is_published=true where match_id=p_match_id and generation_version=v_version;
end $$;

revoke all on function public.generate_balanced_teams(uuid) from public,anon;
grant execute on function public.generate_balanced_teams(uuid) to authenticated;

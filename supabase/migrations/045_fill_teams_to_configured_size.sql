-- Fill each team to the configured size before creating the next partial team.
-- Example: 12 participants, team_size 5 and team_count 3 => 5, 5, 2.
-- Ratings still balance the complete teams with the existing snake order.

create or replace function public.generate_balanced_teams(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_match public.matches;v_version int;v_team_ids uuid[];rec record;i int:=0;idx int;
  v_count int;v_team_count int;v_full_team_count int;v_full_player_count int;
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

  v_team_count:=greatest(2,least(
    4,
    v_match.team_count,
    v_count,
    greatest(2,ceil(v_count::numeric/greatest(v_match.team_size,1))::int)
  ));
  v_full_team_count:=least(v_team_count,floor(v_count::numeric/greatest(v_match.team_size,1))::int);
  v_full_player_count:=v_full_team_count*v_match.team_size;

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
    if v_full_team_count=0 then
      -- With fewer participants than one full team, keep both teams nonempty.
      idx:=case when (i/v_team_count)::int%2=0
        then (i%v_team_count)+1 else v_team_count-(i%v_team_count) end;
    elsif i<v_full_player_count then
      -- Balance ratings only across the teams that can be filled completely.
      idx:=case when (i/v_full_team_count)::int%2=0
        then (i%v_full_team_count)+1 else v_full_team_count-(i%v_full_team_count) end;
    else
      -- Remaining participants go to the next team, up to team_size.
      idx:=v_full_team_count+1+((i-v_full_player_count)/v_match.team_size)::int;
    end if;

    insert into public.team_players(team_id,user_id,guest_id,assigned_position,is_goalkeeper,balance_rating_snapshot)
    values(v_team_ids[idx],rec.user_id,rec.guest_id,rec.preferred_position,rec.preferred_position='goalkeeper',rec.rating);
    i:=i+1;
  end loop;

  update public.matches set status='teams_published' where id=p_match_id;
  update public.teams set is_published=true where match_id=p_match_id and generation_version=v_version;
end $$;

revoke all on function public.generate_balanced_teams(uuid) from public,anon;
grant execute on function public.generate_balanced_teams(uuid) to authenticated;

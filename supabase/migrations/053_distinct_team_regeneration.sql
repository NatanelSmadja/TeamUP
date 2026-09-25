-- Regeneration changes membership, not row order or team colors.
-- Preview never publishes. Acceptance recomputes the exact proposal under a lock.
create or replace function private.team_partition(p_players jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(members order by members::text),'[]'::jsonb)
  from (
    select jsonb_agg(coalesce(p->>'user_id',p->>'guest_id',p->>'id')
      order by coalesce(p->>'user_id',p->>'guest_id',p->>'id')) members
    from jsonb_array_elements(p_players) p group by p->>'team_number'
  ) groups;
$$;

create or replace function private.find_team_alternative(p_players jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  n integer:=jsonb_array_length(p_players); i integer; j integer; a integer; b integer; t integer;
  best_i integer; best_j integer; sums numeric[]:=array[0,0,0,0]::numeric[];
  counts integer[]:=array[0,0,0,0]; old_gap numeric; best_gap numeric;
  gap numeric; low numeric; high numeric; value numeric; shift numeric;
  candidate jsonb; item jsonb; before_partition jsonb;
begin
  before_partition:=private.team_partition(p_players);
  for i in 0..n-1 loop
    item:=p_players->i; t:=(item->>'team_number')::integer;
    if t is null or t not between 1 and 4 then raise exception 'מספר קבוצה אינו תקין'; end if;
    counts[t]:=counts[t]+1; sums[t]:=sums[t]+(item->>'balance_rating_snapshot')::numeric;
  end loop;
  for t in 1..4 loop
    if counts[t]=0 then continue; end if;
    value:=sums[t]/counts[t]; low:=least(low,value); high:=greatest(high,value);
  end loop;
  old_gap:=high-low;
  -- Enumerate legal pair exchanges, preserving each team's size and keepers.
  -- Search is deterministic so accepting a preview cannot select another result.
  for i in 0..n-2 loop
    if coalesce((p_players->i->>'is_locked')::boolean,false) then continue; end if;
    for j in i+1..n-1 loop
      if coalesce((p_players->j->>'is_locked')::boolean,false) then continue; end if;
      a:=(p_players->i->>'team_number')::integer; b:=(p_players->j->>'team_number')::integer;
      if a=b or (counts[a]=1 and counts[b]=1) then continue; end if;
      if coalesce((p_players->i->>'is_goalkeeper')::boolean,false)
         <>coalesce((p_players->j->>'is_goalkeeper')::boolean,false) then continue; end if;
      shift:=(p_players->j->>'balance_rating_snapshot')::numeric-(p_players->i->>'balance_rating_snapshot')::numeric;
      low:=null; high:=null;
      for t in 1..4 loop
        if counts[t]=0 then continue; end if;
        value:=(sums[t]+case when t=a then shift when t=b then -shift else 0 end)/counts[t];
        low:=least(low,value); high:=greatest(high,value);
      end loop;
      gap:=high-low;
      if best_i is null or gap<best_gap then best_i:=i; best_j:=j; best_gap:=gap; end if;
    end loop;
  end loop;
  if best_i is null then return jsonb_build_object('status','no_alternative'); end if;
  candidate:=jsonb_set(p_players,array[best_i::text,'team_number'],p_players->best_j->'team_number');
  candidate:=jsonb_set(candidate,array[best_j::text,'team_number'],p_players->best_i->'team_number');
  if private.team_partition(candidate)=before_partition then return jsonb_build_object('status','no_alternative'); end if;
  return jsonb_build_object(
    'status',case when best_gap<=old_gap+0.00000001 then 'balanced' else 'less_balanced' end,
    'current_balance',round(greatest(0,100-old_gap*20),2),
    'candidate_balance',round(greatest(0,100-best_gap*20),2),
    'candidate_signature',md5(candidate::text),'allocation',candidate);
end;
$$;

create or replace function private.team_regeneration_plan(p_match_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare m public.matches; players jsonb; result jsonb; state text; teams jsonb;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.has_group_permission(m.group_id,'generate_teams') then raise exception 'אין הרשאה ליצור חלוקה חדשה'; end if;
  if m.status<>'teams_published' then raise exception 'ניתן לחלק מחדש רק לאחר פרסום קבוצות'; end if;
  if m.ratings_open or (clock_timestamp() at time zone 'Asia/Jerusalem')>=(m.match_date+m.start_time) then
    raise exception 'לא ניתן ליצור חלוקה חדשה לאחר תחילת המשחק';
  end if;
  select coalesce(jsonb_agg(to_jsonb(tp)||jsonb_build_object('team_number',t.team_number,'profiles',to_jsonb(p),'guest',to_jsonb(g)) order by tp.id),'[]'::jsonb)
    into players from public.team_players tp join public.teams t on t.id=tp.team_id
    left join public.profiles p on p.id=tp.user_id left join public.match_guests g on g.id=tp.guest_id
    where t.match_id=p_match_id and t.is_published;
  if jsonb_array_length(players)>least(m.capacity,m.team_size*m.team_count) then raise exception 'מספר המשתתפים חורג מהגדרות המשחק'; end if;
  state:=md5(players::text||jsonb_build_array(m.team_size,m.team_count,m.capacity)::text);
  result:=private.find_team_alternative(players);
  select jsonb_agg(to_jsonb(t) order by t.team_number) into teams from public.teams t where t.match_id=p_match_id and t.is_published;
  return result||jsonb_build_object('expected_state',state,'teams',teams);
end;
$$;

create or replace function public.preview_team_regeneration(p_match_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select private.team_regeneration_plan(p_match_id);
$$;

create or replace function public.apply_team_regeneration(
  p_match_id uuid,p_expected_state text,p_candidate_signature text,p_allow_less_balanced boolean default false
)
returns void language plpgsql security definer set search_path='' as $$
declare plan jsonb; version integer; team record; team_id uuid; item jsonb;
begin
  plan:=private.team_regeneration_plan(p_match_id);
  if p_expected_state is distinct from plan->>'expected_state' then
    raise exception 'החלוקה השתנתה מאז הבדיקה. יש לבקש חלוקה מחדש';
  end if;
  if plan->>'status'='no_alternative' then raise exception 'לא נמצאה חלוקה שונה מתאימה. החלוקה הנוכחית נשארה'; end if;
  if p_candidate_signature is distinct from plan->>'candidate_signature' then raise exception 'החלופה השתנתה. יש לבדוק מחדש'; end if;
  if plan->>'status'='less_balanced' and not coalesce(p_allow_less_balanced,false) then
    raise exception 'החלופה פחות מאוזנת ונדרש אישור לפני פרסום';
  end if;
  select coalesce(max(generation_version),0)+1 into version from public.teams where match_id=p_match_id;
  for team in select * from public.teams where match_id=p_match_id and is_published order by team_number loop
    insert into public.teams(match_id,name,team_number,generation_version,color_key)
    values(p_match_id,team.name,team.team_number,version,team.color_key) returning id into team_id;
    for item in select value from jsonb_array_elements(plan->'allocation') where (value->>'team_number')::integer=team.team_number loop
      insert into public.team_players(team_id,user_id,guest_id,assigned_position,is_goalkeeper,is_locked,balance_rating_snapshot)
      values(team_id,(item->>'user_id')::uuid,(item->>'guest_id')::uuid,item->>'assigned_position',
        (item->>'is_goalkeeper')::boolean,coalesce((item->>'is_locked')::boolean,false),(item->>'balance_rating_snapshot')::numeric);
    end loop;
  end loop;
  update public.teams set is_published=(generation_version=version) where match_id=p_match_id;
end;
$$;

-- Older clients may only publish an equally balanced or better, distinct result.
create or replace function public.regenerate_balanced_teams(p_match_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare plan jsonb;
begin
  plan:=private.team_regeneration_plan(p_match_id);
  perform public.apply_team_regeneration(p_match_id,plan->>'expected_state',plan->>'candidate_signature',false);
end;
$$;
revoke all on function private.team_partition(jsonb),private.find_team_alternative(jsonb),private.team_regeneration_plan(uuid) from public,anon,authenticated;
revoke all on function public.preview_team_regeneration(uuid),public.apply_team_regeneration(uuid,text,text,boolean),public.regenerate_balanced_teams(uuid) from public,anon;
grant execute on function public.preview_team_regeneration(uuid),public.apply_team_regeneration(uuid,text,text,boolean),public.regenerate_balanced_teams(uuid) to authenticated;
notify pgrst,'reload schema';

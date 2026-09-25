-- Fixed capacities, goalkeeper coverage and rating balance across ALL teams.
-- Apply after 051. The private helper is also exercised by PostgreSQL tests.
create schema if not exists private;

create or replace function private.allocate_match_teams(p_players jsonb,p_size integer,p_team_count integer)
returns jsonb language plpgsql set search_path='' as $$
declare
  n integer; k integer; i integer; j integer; t integer; a integer; b integer;
  chosen integer; min_keepers integer; pass integer; best_i integer; best_j integer;
  sizes integer[]; counts integer[]; keepers integer[]; assigned integer[];
  ratings numeric[]; is_keeper boolean[]; sums numeric[];
  mean_rating numeric; delta numeric; best_delta numeric; shift numeric;
  players jsonb; result jsonb:='[]'::jsonb;
begin
  if p_players is null or jsonb_typeof(p_players)<>'array' then
    raise exception 'רשימת המשתתפים אינה תקינה';
  end if;
  n:=jsonb_array_length(p_players);
  if p_size is null or p_size<1 or p_size>50 or p_team_count is null or p_team_count not between 2 and 4 then
    raise exception 'הגדרות הקבוצות אינן תקינות';
  end if;
  if n<2 then raise exception 'צריך לפחות שני משתתפים לחלוקה'; end if;
  if n>p_size*p_team_count then
    raise exception 'מספר המשתתפים חורג ממספר המקומות בקבוצות. יש לעדכן את הגדרות המשחק';
  end if;
  if exists(select 1 from jsonb_array_elements(p_players) p
    where (p->>'rating') is null or (p->>'rating')::numeric not between 1 and 5) then
    raise exception 'דירוג משתתף אינו תקין';
  end if;

  -- Randomness only breaks ties; capacities and keeper coverage stay fixed.
  select jsonb_agg(p order by coalesce((p->>'is_goalkeeper')::boolean,false) desc,
    (p->>'rating')::numeric desc,random()) into players from jsonb_array_elements(p_players) p;
  k:=greatest(2,ceil(n::numeric/p_size)::integer);
  sizes:=array_fill(p_size,array[k]);
  if n<2*p_size then
    sizes[1]:=(n+1)/2; sizes[2]:=n/2;
  else
    sizes[k]:=n-(k-1)*p_size;
  end if;
  counts:=array_fill(0,array[k]); keepers:=counts;
  sums:=array_fill(0::numeric,array[k]);
  assigned:=array_fill(0,array[n]);
  select array_agg((p->>'rating')::numeric order by ord),
    array_agg(coalesce((p->>'is_goalkeeper')::boolean,false) order by ord),
    avg((p->>'rating')::numeric)
  into ratings,is_keeper,mean_rating
  from jsonb_array_elements(players) with ordinality as x(p,ord);

  for i in 1..n loop
    chosen:=null; best_delta:=null; min_keepers:=null;
    if is_keeper[i] then
      select min(keepers[s]) into min_keepers from generate_series(1,k) s where counts[s]<sizes[s];
    end if;
    for t in 1..k loop
      if counts[t]>=sizes[t] or (is_keeper[i] and keepers[t]<>min_keepers) then continue; end if;
      -- Estimate the final mean with neutral (overall-mean) unfilled slots.
      delta:=power((sums[t]+ratings[i]-(counts[t]+1)*mean_rating)/sizes[t],2)
        -power((sums[t]-counts[t]*mean_rating)/sizes[t],2);
      if chosen is null or delta<best_delta then chosen:=t; best_delta:=delta; end if;
    end loop;
    assigned[i]:=chosen; counts[chosen]:=counts[chosen]+1;
    sums[chosen]:=sums[chosen]+ratings[i];
    if is_keeper[i] then keepers[chosen]:=keepers[chosen]+1; end if;
  end loop;

  -- Best improving pair swaps preserve sizes AND goalkeeper counts.
  -- Bounded local optimization, not a claim of a global optimum.
  for pass in 1..100 loop
    best_i:=null; best_delta:=-0.00000001;
    for i in 1..n-1 loop
      for j in i+1..n loop
        a:=assigned[i]; b:=assigned[j];
        if a=b or is_keeper[i]<>is_keeper[j] then continue; end if;
        shift:=ratings[j]-ratings[i];
        delta:=power((sums[a]+shift)/sizes[a]-mean_rating,2)
          +power((sums[b]-shift)/sizes[b]-mean_rating,2)
          -power(sums[a]/sizes[a]-mean_rating,2)-power(sums[b]/sizes[b]-mean_rating,2);
        if delta<best_delta then best_delta:=delta; best_i:=i; best_j:=j; end if;
      end loop;
    end loop;
    exit when best_i is null;
    a:=assigned[best_i]; b:=assigned[best_j]; shift:=ratings[best_j]-ratings[best_i];
    sums[a]:=sums[a]+shift; sums[b]:=sums[b]-shift;
    assigned[best_i]:=b; assigned[best_j]:=a;
  end loop;
  for i in 1..n loop
    result:=result||jsonb_build_array((players->(i-1))||jsonb_build_object('team_number',assigned[i]));
  end loop;
  return result;
end;
$$;
revoke all on function private.allocate_match_teams(jsonb,integer,integer) from public,anon,authenticated;

create or replace function public.generate_balanced_teams(p_match_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  m public.matches; players jsonb; allocation jsonb; rec jsonb;
  team_ids uuid[]:='{}'; team_id uuid; version integer; team_count integer; idx integer;
  colors text[]:=array['red','blue','yellow','green'];
  names text[]:=array['האדומים','הכחולים','הצהובים','הירוקים'];
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.has_group_permission(m.group_id,'generate_teams') then raise exception 'אין הרשאה ליצור קבוצות'; end if;
  if m.status<>'registration_closed' or m.ratings_open then raise exception 'יש לסגור את ההרשמה לפני יצירת הקבוצות'; end if;

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into players from (
    select mr.user_id,null::uuid guest_id,p.preferred_position,
      p.preferred_position='goalkeeper' is_goalkeeper,
      coalesce((select round(avg(pr.overall_rating)::numeric,2)
        from public.player_ratings pr join public.matches rated on rated.id=pr.match_id
        where pr.rated_user_id=mr.user_id and rated.group_id=m.group_id and rated.status='completed'),p.base_rating,3) rating
    from public.match_registrations mr join public.profiles p on p.id=mr.user_id
    where mr.match_id=p_match_id and mr.registration_status='confirmed'
    union all
    select null::uuid,g.id,g.preferred_position,g.preferred_position='goalkeeper',g.balance_rating
    from public.match_guests g where g.match_id=p_match_id
  ) x;
  if jsonb_array_length(players)>m.capacity then raise exception 'מספר המשתתפים חורג מקיבולת המשחק'; end if;
  allocation:=private.allocate_match_teams(players,m.team_size,m.team_count);
  select max((p->>'team_number')::integer) into team_count from jsonb_array_elements(allocation) p;
  select coalesce(max(generation_version),0)+1 into version from public.teams where match_id=p_match_id;
  for idx in 1..team_count loop
    insert into public.teams(match_id,name,team_number,generation_version,color_key)
    values(p_match_id,names[idx],idx,version,colors[idx]) returning id into team_id;
    team_ids:=array_append(team_ids,team_id);
  end loop;
  for rec in select value from jsonb_array_elements(allocation) loop
    insert into public.team_players(team_id,user_id,guest_id,assigned_position,is_goalkeeper,balance_rating_snapshot)
    values(team_ids[(rec->>'team_number')::integer],(rec->>'user_id')::uuid,(rec->>'guest_id')::uuid,
      rec->>'preferred_position',coalesce((rec->>'is_goalkeeper')::boolean,false),(rec->>'rating')::numeric);
  end loop;
  update public.teams set is_published=(generation_version=version) where match_id=p_match_id;
  update public.matches set status='teams_published' where id=p_match_id;
end;
$$;
revoke all on function public.generate_balanced_teams(uuid) from public,anon;
grant execute on function public.generate_balanced_teams(uuid) to authenticated;

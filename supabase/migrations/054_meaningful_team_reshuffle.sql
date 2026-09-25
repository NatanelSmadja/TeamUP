-- Replace pair-only regeneration with a deterministic multi-start reshuffle.
create or replace function private.find_team_alternative_pair(p_players jsonb)
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

create or replace function private.find_team_alternative(p_players jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  n integer:=jsonb_array_length(p_players); i integer; j integer; t integer; a integer; b integer;
  trial integer; step integer; attempts integer; steps integer; keeper boolean;
  original integer[]; assigned integer[]; locked boolean[]; goalkeepers boolean[]; ratings numeric[];
  slots integer[]; shuffled integer[]; counts integer[]:=array[0,0,0,0]; sums numeric[];
  mean_rating numeric; low numeric; high numeric; gap numeric; old_gap numeric;
  delta numeric; best_delta numeric; shift numeric; best_i integer; best_j integer;
  total_pairs integer:=0; retained integer; novelty numeric; tier integer;
  best_tier integer:=-1; best_gap numeric; best_novelty numeric:=-1; best_assignment integer[];
  fallback jsonb; candidate jsonb; seed text:=md5(p_players::text);
begin
  -- Keep a complete legal pair search as a fallback when locks restrict mixing.
  fallback:=private.find_team_alternative_pair(p_players);
  if fallback->>'status'='no_alternative' then return fallback; end if;
  select array_agg((p->>'team_number')::integer order by ord),
    array_agg(coalesce((p->>'is_locked')::boolean,false) order by ord),
    array_agg(coalesce((p->>'is_goalkeeper')::boolean,false) order by ord),
    array_agg((p->>'balance_rating_snapshot')::numeric order by ord),
    avg((p->>'balance_rating_snapshot')::numeric)
  into original,locked,goalkeepers,ratings,mean_rating
  from jsonb_array_elements(p_players) with ordinality x(p,ord);
  sums:=array[0,0,0,0]::numeric[];
  for i in 1..n loop
    counts[original[i]]:=counts[original[i]]+1;
    sums[original[i]]:=sums[original[i]]+ratings[i];
  end loop;
  for t in 1..4 loop
    if counts[t]=0 then continue; end if;
    total_pairs:=total_pairs+counts[t]*(counts[t]-1)/2;
    low:=least(low,sums[t]/counts[t]); high:=greatest(high,sums[t]/counts[t]);
  end loop;
  old_gap:=high-low;
  attempts:=case when n<=30 then 48 else 8 end;
  steps:=case when n<=30 then 20 else 8 end;

  for trial in 0..attempts loop
    if trial=0 then
      select array_agg((p->>'team_number')::integer order by ord) into assigned
      from jsonb_array_elements(fallback->'allocation') with ordinality x(p,ord);
    else
      assigned:=original;
      -- Shuffle the available slots separately for keepers and field players.
      -- MD5 is a deterministic shuffle key, not a security token: the same
      -- state must produce the exact same preview when accepted later.
      foreach keeper in array array[false,true] loop
        select array_agg(s order by s),array_agg(original[s] order by md5(seed||':'||trial||':'||s),s)
        into slots,shuffled from generate_series(1,n) s where not locked[s] and goalkeepers[s]=keeper;
        if slots is not null then
          for i in 1..array_length(slots,1) loop assigned[slots[i]]:=shuffled[i]; end loop;
        end if;
      end loop;
    end if;
    sums:=array[0,0,0,0]::numeric[];
    for i in 1..n loop sums[assigned[i]]:=sums[assigned[i]]+ratings[i]; end loop;

    for step in 0..steps loop
      low:=null; high:=null; retained:=0;
      for t in 1..4 loop
        if counts[t]>0 then low:=least(low,sums[t]/counts[t]); high:=greatest(high,sums[t]/counts[t]); end if;
      end loop;
      gap:=high-low;
      for i in 1..n-1 loop
        for j in i+1..n loop
          if original[i]=original[j] and assigned[i]=assigned[j] then retained:=retained+1; end if;
        end loop;
      end loop;
      -- Count changed teammate relationships, independent of team colors/order.
      novelty:=1-retained::numeric/greatest(total_pairs,1);
      if novelty>0 then
        -- Prefer a broad reshuffle (40% new teammate pairs). Inside that tier,
        -- prefer equal/better balance; otherwise offer the closest alternative.
        tier:=(case when novelty>=0.4 then 2 else 0 end)+(case when gap<=old_gap+0.00000001 then 1 else 0 end);
        if tier>best_tier or (tier=best_tier and (
          (tier%2=1 and (novelty>best_novelty or (novelty=best_novelty and gap<best_gap)))
          or (tier%2=0 and (gap<best_gap or (gap=best_gap and novelty>best_novelty)))
        )) then
          best_tier:=tier; best_gap:=gap; best_novelty:=novelty; best_assignment:=assigned;
        end if;
      end if;
      exit when step=steps or trial=0;
      best_i:=null; best_delta:=-0.00000001;
      for i in 1..n-1 loop
        if locked[i] then continue; end if;
        for j in i+1..n loop
          a:=assigned[i]; b:=assigned[j];
          if locked[j] or a=b or goalkeepers[i]<>goalkeepers[j] then continue; end if;
          shift:=ratings[j]-ratings[i];
          delta:=power((sums[a]+shift)/counts[a]-mean_rating,2)+power((sums[b]-shift)/counts[b]-mean_rating,2)
            -power(sums[a]/counts[a]-mean_rating,2)-power(sums[b]/counts[b]-mean_rating,2);
          if delta<best_delta then best_delta:=delta; best_i:=i; best_j:=j; end if;
        end loop;
      end loop;
      exit when best_i is null;
      a:=assigned[best_i]; b:=assigned[best_j]; shift:=ratings[best_j]-ratings[best_i];
      sums[a]:=sums[a]+shift; sums[b]:=sums[b]-shift;
      assigned[best_i]:=b; assigned[best_j]:=a;
    end loop;
  end loop;
  if best_assignment is null then return jsonb_build_object('status','no_alternative'); end if;
  select jsonb_agg(p||jsonb_build_object('team_number',best_assignment[ord]) order by ord)
    into candidate from jsonb_array_elements(p_players) with ordinality x(p,ord);
  if private.team_partition(candidate)=private.team_partition(p_players) then return jsonb_build_object('status','no_alternative'); end if;
  return jsonb_build_object(
    'status',case when best_gap<=old_gap+0.00000001 then 'balanced' else 'less_balanced' end,
    'current_balance',round(greatest(0,100-old_gap*20),2),
    'candidate_balance',round(greatest(0,100-best_gap*20),2),
    'changed_teammate_percent',round(best_novelty*100),
    'candidate_signature',md5(candidate::text),'allocation',candidate);
end;
$$;
revoke all on function private.find_team_alternative_pair(jsonb),private.find_team_alternative(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';

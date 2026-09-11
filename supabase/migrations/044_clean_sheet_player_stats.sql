-- Registered-player clean-sheet stats.
-- Team wins remain match-night data only. Guest clean sheets remain visible in
-- the match summary but are intentionally excluded from persistent player stats.

create index if not exists match_clean_sheets_player_stats_idx
  on public.match_clean_sheet_events(goalkeeper_user_id,match_id)
  where cancelled_at is null and goalkeeper_user_id is not null;

create or replace function public.get_player_clean_sheet_stats(
  p_user_id uuid,p_group_id uuid
) returns table(clean_sheets bigint,matches_with_clean_sheet bigint)
language sql stable security definer set search_path=public as $$
  select count(cs.id),count(distinct cs.match_id)
  from public.group_members gm
  left join public.matches m
    on m.group_id=gm.group_id and m.status='completed'
  left join public.match_clean_sheet_events cs
    on cs.match_id=m.id
   and cs.goalkeeper_user_id=gm.user_id
   and cs.cancelled_at is null
  where gm.group_id=p_group_id
    and gm.user_id=p_user_id
    and gm.status='active'
    and public.is_group_member(p_group_id);
$$;

create or replace function public.get_group_clean_sheet_leaderboard(p_group_id uuid)
returns table(user_id uuid,first_name text,last_name text,clean_sheets bigint,matches_with_clean_sheet bigint)
language sql stable security definer set search_path=public as $$
  select p.id,p.first_name,p.last_name,count(cs.id),count(distinct cs.match_id)
  from public.match_clean_sheet_events cs
  join public.matches m on m.id=cs.match_id and m.status='completed'
  join public.profiles p on p.id=cs.goalkeeper_user_id
  join public.group_members gm
    on gm.group_id=m.group_id and gm.user_id=p.id and gm.status='active'
  where m.group_id=p_group_id
    and cs.cancelled_at is null
    and cs.goalkeeper_user_id is not null
    and public.is_group_member(p_group_id)
  group by p.id,p.first_name,p.last_name
  order by count(cs.id) desc,count(distinct cs.match_id) desc,p.first_name,p.last_name,p.id
  limit 3;
$$;

revoke all on function public.get_player_clean_sheet_stats(uuid,uuid) from public,anon;
revoke all on function public.get_group_clean_sheet_leaderboard(uuid) from public,anon;
grant execute on function public.get_player_clean_sheet_stats(uuid,uuid) to authenticated;
grant execute on function public.get_group_clean_sheet_leaderboard(uuid) to authenticated;

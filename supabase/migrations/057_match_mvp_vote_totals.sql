-- Publish aggregate MVP votes for one completed match without exposing ballots.
create or replace function public.get_match_mvp_vote_totals(p_match_id uuid)
returns table(user_id uuid,first_name text,last_name text,avatar_url text,vote_count bigint)
language plpgsql stable security definer set search_path=public as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where id=p_match_id;
  if not found then raise exception 'המשחק לא נמצא'; end if;

  if not coalesce(public.is_group_member(v_match.group_id),false)
     and not coalesce(public.is_system_admin(),false) then
    raise exception 'אין הרשאה לצפות בתוצאות ההצבעה' using errcode='42501';
  end if;

  -- While voting is possible, totals would influence later votes.
  if v_match.status<>'completed' or
     (v_match.ratings_open and (v_match.ratings_closes_at is null or v_match.ratings_closes_at>now())) then
    return;
  end if;

  return query
  select p.id,p.first_name,p.last_name,p.avatar_url,count(*)::bigint
  from public.mvp_votes mv
  join public.profiles p on p.id=mv.voted_user_id
  where mv.match_id=p_match_id
  group by p.id,p.first_name,p.last_name,p.avatar_url
  order by count(*) desc,p.first_name,p.last_name,p.id;
end;
$$;
revoke all on function public.get_match_mvp_vote_totals(uuid) from public,anon;
grant execute on function public.get_match_mvp_vote_totals(uuid) to authenticated;

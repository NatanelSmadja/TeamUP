-- Persistent draw of the two teams that open a match night.

create table if not exists public.match_opening_draws (
  match_id uuid primary key references public.matches(id) on delete cascade,
  first_team_id uuid not null references public.teams(id) on delete cascade,
  second_team_id uuid not null references public.teams(id) on delete cascade,
  drawn_by uuid not null references public.profiles(id) on delete restrict,
  drawn_at timestamptz not null default now(),
  draw_number integer not null default 1 check(draw_number > 0),
  constraint match_opening_draw_distinct_teams check(first_team_id <> second_team_id)
);

alter table public.match_opening_draws enable row level security;

drop policy if exists "opening draw visible to group" on public.match_opening_draws;
create policy "opening draw visible to group"
on public.match_opening_draws for select to authenticated
using(exists(
  select 1 from public.matches m
  where m.id=match_opening_draws.match_id
    and public.is_group_member(m.group_id)
) or public.is_system_admin());

revoke insert,update,delete on public.match_opening_draws from anon,authenticated;
grant select on public.match_opening_draws to authenticated;

create or replace function public.draw_match_opening_teams(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_match public.matches;
  v_user uuid:=(select auth.uid());
  v_team_ids uuid[];
  v_draw_number integer;
begin
  if v_user is null then raise exception 'יש להתחבר כדי לבצע הגרלה'; end if;

  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.is_match_result_manager(p_match_id) then
    raise exception 'אין הרשאה לבצע את הגרלת הפתיחה';
  end if;
  if v_match.status<>'teams_published' or v_match.ratings_open then
    raise exception 'ניתן לבצע הגרלה רק במשחק פעיל לאחר פרסום הקבוצות';
  end if;

  select array(
    select t.id
    from public.teams t
    where t.match_id=p_match_id and t.is_published=true
    order by random()
    limit 2
  ) into v_team_ids;

  if coalesce(array_length(v_team_ids,1),0)<2 then
    raise exception 'נדרשות לפחות שתי קבוצות פעילות להגרלה';
  end if;

  insert into public.match_opening_draws(
    match_id,first_team_id,second_team_id,drawn_by,drawn_at,draw_number
  ) values(
    p_match_id,v_team_ids[1],v_team_ids[2],v_user,clock_timestamp(),1
  )
  on conflict(match_id) do update set
    first_team_id=excluded.first_team_id,
    second_team_id=excluded.second_team_id,
    drawn_by=v_user,
    drawn_at=clock_timestamp(),
    draw_number=public.match_opening_draws.draw_number+1
  returning draw_number into v_draw_number;

  return jsonb_build_object(
    'match_id',p_match_id,
    'first_team_id',v_team_ids[1],
    'second_team_id',v_team_ids[2],
    'drawn_by',v_user,
    'drawn_at',clock_timestamp(),
    'draw_number',v_draw_number
  );
end;
$$;

revoke all on function public.draw_match_opening_teams(uuid) from public,anon;
grant execute on function public.draw_match_opening_teams(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.match_opening_draws;
exception when duplicate_object then null; end $$;

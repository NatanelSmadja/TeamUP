-- TEAMUP V2.3: advanced team editing, achievements, player of the month and emergency call
alter table public.team_players add column if not exists is_locked boolean not null default false;

create table if not exists public.team_edit_history (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  batch_id uuid not null default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  from_team_id uuid references public.teams(id) on delete set null,
  to_team_id uuid references public.teams(id) on delete set null,
  performed_by uuid not null references public.profiles(id),
  undone_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists team_edit_history_match_idx on public.team_edit_history(match_id,created_at desc);
alter table public.team_edit_history enable row level security;
drop policy if exists "managers read team history" on public.team_edit_history;
create policy "managers read team history" on public.team_edit_history for select to authenticated using(
 exists(select 1 from public.matches m where m.id=match_id and (public.has_group_permission(m.group_id,'edit_teams') or public.has_group_permission(m.group_id,'generate_teams')))
);

do $$ begin alter publication supabase_realtime add table public.team_edit_history; exception when duplicate_object then null; end $$;

create or replace function public.toggle_team_player_lock(p_match_id uuid,p_user_id uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare g uuid; new_value boolean;
begin
 select group_id into g from public.matches where id=p_match_id;
 if not public.has_group_permission(g,'edit_teams') and not public.has_group_permission(g,'generate_teams') then raise exception 'אין הרשאה לעריכת קבוצות'; end if;
 update public.team_players tp set is_locked=not tp.is_locked
 where tp.user_id=p_user_id and exists(select 1 from public.teams t where t.id=tp.team_id and t.match_id=p_match_id and t.is_published)
 returning is_locked into new_value;
 if new_value is null then raise exception 'השחקן לא נמצא בחלוקה הפעילה'; end if;
 return new_value;
end $$;
grant execute on function public.toggle_team_player_lock(uuid,uuid) to authenticated;

create or replace function public.move_team_player(p_match_id uuid,p_user_id uuid,p_target_team_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare g uuid; source_player uuid; source_team uuid; locked boolean; batch uuid:=gen_random_uuid();
begin
 select group_id into g from public.matches where id=p_match_id;
 if not public.has_group_permission(g,'edit_teams') and not public.has_group_permission(g,'generate_teams') then raise exception 'אין הרשאה לעריכת קבוצות'; end if;
 if not exists(select 1 from public.teams where id=p_target_team_id and match_id=p_match_id and is_published) then raise exception 'קבוצת היעד אינה שייכת לחלוקה הפעילה'; end if;
 select tp.id,tp.team_id,tp.is_locked into source_player,source_team,locked from public.team_players tp join public.teams t on t.id=tp.team_id where t.match_id=p_match_id and t.is_published and tp.user_id=p_user_id limit 1;
 if source_player is null then raise exception 'השחקן לא נמצא בקבוצות'; end if;
 if locked then raise exception 'השחקן נעול. יש לפתוח את הנעילה לפני העברה'; end if;
 if source_team=p_target_team_id then return; end if;
 insert into public.team_edit_history(match_id,batch_id,user_id,from_team_id,to_team_id,performed_by) values(p_match_id,batch,p_user_id,source_team,p_target_team_id,auth.uid());
 update public.team_players set team_id=p_target_team_id where id=source_player;
end $$;
grant execute on function public.move_team_player(uuid,uuid,uuid) to authenticated;

create or replace function public.swap_team_players(p_match_id uuid,p_first_user uuid,p_second_user uuid) returns void
language plpgsql security definer set search_path=public as $$
declare g uuid; first_id uuid;second_id uuid;first_team uuid;second_team uuid;first_locked boolean;second_locked boolean;batch uuid:=gen_random_uuid();
begin
 select group_id into g from public.matches where id=p_match_id;
 if not public.has_group_permission(g,'edit_teams') and not public.has_group_permission(g,'generate_teams') then raise exception 'אין הרשאה לעריכת קבוצות'; end if;
 select tp.id,tp.team_id,tp.is_locked into first_id,first_team,first_locked from public.team_players tp join public.teams t on t.id=tp.team_id where t.match_id=p_match_id and t.is_published and tp.user_id=p_first_user limit 1;
 select tp.id,tp.team_id,tp.is_locked into second_id,second_team,second_locked from public.team_players tp join public.teams t on t.id=tp.team_id where t.match_id=p_match_id and t.is_published and tp.user_id=p_second_user limit 1;
 if first_id is null or second_id is null then raise exception 'אחד השחקנים לא נמצא בחלוקה'; end if;
 if first_locked or second_locked then raise exception 'אחד השחקנים נעול'; end if;
 if first_team=second_team then raise exception 'השחקנים כבר באותה קבוצה'; end if;
 insert into public.team_edit_history(match_id,batch_id,user_id,from_team_id,to_team_id,performed_by) values
 (p_match_id,batch,p_first_user,first_team,second_team,auth.uid()),(p_match_id,batch,p_second_user,second_team,first_team,auth.uid());
 update public.team_players set team_id=case when id=first_id then second_team when id=second_id then first_team end where id in(first_id,second_id);
end $$;
grant execute on function public.swap_team_players(uuid,uuid,uuid) to authenticated;

create or replace function public.undo_last_team_edit(p_match_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare g uuid; b uuid; rec record;
begin
 select group_id into g from public.matches where id=p_match_id;
 if not public.has_group_permission(g,'edit_teams') and not public.has_group_permission(g,'generate_teams') then raise exception 'אין הרשאה לעריכת קבוצות'; end if;
 select batch_id into b from public.team_edit_history where match_id=p_match_id and undone_at is null order by created_at desc,id desc limit 1;
 if b is null then raise exception 'אין שינוי שניתן לבטל'; end if;
 for rec in select * from public.team_edit_history where batch_id=b order by id desc loop
  update public.team_players tp set team_id=rec.from_team_id where tp.user_id=rec.user_id and exists(select 1 from public.teams t where t.id=tp.team_id and t.match_id=p_match_id and t.is_published);
 end loop;
 update public.team_edit_history set undone_at=now() where batch_id=b;
end $$;
grant execute on function public.undo_last_team_edit(uuid) to authenticated;

create or replace function public.notify_missing_players(p_match_id uuid) returns int
language plpgsql security definer set search_path=public as $$
declare m public.matches; sent int;
begin
 select * into m from public.matches where id=p_match_id;
 if not found or (not public.has_group_permission(m.group_id,'create_match') and not public.has_group_permission(m.group_id,'manage_registrations')) then raise exception 'אין הרשאה'; end if;
 insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
 select gm.user_id,'players_needed','חסרים שחקנים למשחק',m.title||' עדיין מחפש שחקנים. אפשר להירשם עכשיו.','match',m.id
 from public.group_members gm
 where gm.group_id=m.group_id and gm.status='active' and not exists(
  select 1 from public.match_registrations mr where mr.match_id=m.id and mr.user_id=gm.user_id and mr.registration_status in('confirmed','waitlisted')
 );
 get diagnostics sent=row_count;
 perform public.log_activity(m.group_id,auth.uid(),'players_needed','חסרים שחקנים למשחק',sent||' חברים קיבלו התראה','match',m.id);
 return sent;
end $$;
grant execute on function public.notify_missing_players(uuid) to authenticated;

create or replace function public.get_player_of_month(p_group_id uuid,p_month date default date_trunc('month',current_date)::date)
returns table(user_id uuid,first_name text,last_name text,avg_rating numeric,rating_count bigint,mvp_count bigint,games_count bigint,score numeric)
language sql security definer set search_path=public stable as $$
 with ratings as(
  select pr.rated_user_id user_id,avg(pr.overall_rating)::numeric(4,2) avg_rating,count(*) rating_count
  from public.player_ratings pr join public.matches m on m.id=pr.match_id
  where m.group_id=p_group_id and pr.created_at>=date_trunc('month',p_month) and pr.created_at<date_trunc('month',p_month)+interval '1 month'
  group by pr.rated_user_id
 ), mvps as(
  select mv.voted_user_id user_id,count(*) mvp_count from public.mvp_votes mv join public.matches m on m.id=mv.match_id
  where m.group_id=p_group_id and mv.created_at>=date_trunc('month',p_month) and mv.created_at<date_trunc('month',p_month)+interval '1 month' group by mv.voted_user_id
 ), games as(
  select mr.user_id,count(*) games_count from public.match_registrations mr join public.matches m on m.id=mr.match_id
  where m.group_id=p_group_id and mr.registration_status='confirmed' and m.match_date>=date_trunc('month',p_month)::date and m.match_date<(date_trunc('month',p_month)+interval '1 month')::date group by mr.user_id
 )
 select p.id,p.first_name,p.last_name,coalesce(r.avg_rating,0),coalesce(r.rating_count,0),coalesce(v.mvp_count,0),coalesce(g.games_count,0),
 (coalesce(r.avg_rating,0)*20+coalesce(v.mvp_count,0)*8+coalesce(g.games_count,0)*2)::numeric(8,2) score
 from public.profiles p join public.group_members gm on gm.user_id=p.id and gm.group_id=p_group_id and gm.status='active'
 left join ratings r on r.user_id=p.id left join mvps v on v.user_id=p.id left join games g on g.user_id=p.id
 where public.is_group_member(p_group_id)
 order by score desc,rating_count desc limit 1;
$$;
grant execute on function public.get_player_of_month(uuid,date) to authenticated;

create or replace function public.regenerate_balanced_teams(p_match_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare g uuid; old_status public.match_status;
begin
 select group_id,status into g,old_status from public.matches where id=p_match_id;
 if not public.has_group_permission(g,'generate_teams') then raise exception 'אין הרשאה'; end if;
 update public.teams set is_published=false where match_id=p_match_id and is_published;
 update public.matches set status='registration_closed' where id=p_match_id;
 perform public.generate_balanced_teams(p_match_id);
end $$;
grant execute on function public.regenerate_balanced_teams(uuid) to authenticated;

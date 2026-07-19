-- TEAMUP V4: realtime, flexible teams, multiple positions, member management and notifications
alter table public.profiles add column if not exists preferred_positions text[] not null default '{}';
update public.profiles set preferred_positions=array[coalesce(preferred_position,'utility')] where cardinality(preferred_positions)=0;

-- Realtime publication (safe when tables were already added)
do $$ begin alter publication supabase_realtime add table public.matches; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.match_registrations; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.weekly_polls; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.availability_votes; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.group_members; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.teams; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.team_players; exception when duplicate_object then null; end $$;

create or replace function public.generate_balanced_teams(p_match_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v_match public.matches;v_version int;v_team_ids uuid[];rec record;i int:=0;idx int;v_count int;v_team_count int;
begin
 select * into v_match from public.matches where id=p_match_id;
 if not found or not public.has_group_permission(v_match.group_id,'generate_teams') then raise exception 'אין הרשאה';end if;
 if v_match.status<>'registration_closed' then raise exception 'אפשר לערבב קבוצות רק אחרי סגירת ההרשמה';end if;
 select count(*) into v_count from public.match_registrations where match_id=p_match_id and registration_status='confirmed';
 if v_count<4 then raise exception 'צריך לפחות 4 שחקנים לחלוקה';end if;
 v_team_count:=greatest(2,least(v_match.team_count,round(v_count::numeric/greatest(v_match.team_size,1))::int));
 select coalesce(max(generation_version),0)+1 into v_version from public.teams where match_id=p_match_id;
 v_team_ids:=array[]::uuid[];
 for idx in 1..v_team_count loop insert into public.teams(match_id,name,team_number,generation_version) values(p_match_id,'קבוצה '||idx,idx,v_version) returning id into rec;v_team_ids:=array_append(v_team_ids,rec.id);end loop;
 for rec in select mr.user_id,p.base_rating,p.preferred_position from public.match_registrations mr join public.profiles p on p.id=mr.user_id where mr.match_id=p_match_id and mr.registration_status='confirmed' order by (p.preferred_position='goalkeeper') desc,p.base_rating desc,random() loop idx:=(i%v_team_count)+1;insert into public.team_players(team_id,user_id,assigned_position,is_goalkeeper) values(v_team_ids[idx],rec.user_id,rec.preferred_position,rec.preferred_position='goalkeeper');i:=i+1;end loop;
 update public.matches set status='teams_published',team_count=v_team_count where id=p_match_id;update public.teams set is_published=true where match_id=p_match_id and generation_version=v_version;
end $$;
grant execute on function public.generate_balanced_teams(uuid) to authenticated;

create or replace function public.remove_group_member(p_member_id uuid,p_permanent boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare m public.group_members;begin select * into m from public.group_members where id=p_member_id;if not found then raise exception 'השחקן לא נמצא';end if;if not public.is_group_admin(m.group_id) then raise exception 'רק מנהל ראשי יכול להסיר שחקן';end if;if m.role='admin' then raise exception 'לא ניתן להסיר את המנהל הראשי';end if;if p_permanent then delete from auth.users where id=m.user_id;else update public.group_members set status='inactive' where id=p_member_id;end if;end $$;
grant execute on function public.remove_group_member(uuid,boolean) to authenticated;
create or replace function public.restore_group_member(p_member_id uuid) returns void language plpgsql security definer set search_path=public as $$declare m public.group_members;begin select * into m from public.group_members where id=p_member_id;if not public.is_group_admin(m.group_id) then raise exception 'אין הרשאה';end if;update public.group_members set status='active' where id=p_member_id;end $$;
grant execute on function public.restore_group_member(uuid) to authenticated;

create or replace function public.notify_group(p_group uuid,p_type text,p_title text,p_message text,p_entity_type text default null,p_entity_id uuid default null) returns void language plpgsql security definer set search_path=public as $$begin insert into public.notifications(user_id,type,title,message,entity_type,entity_id) select user_id,p_type,p_title,p_message,p_entity_type,p_entity_id from public.group_members where group_id=p_group and status='active';end $$;

create or replace function public.notify_new_poll() returns trigger language plpgsql security definer set search_path=public as $$begin perform public.notify_group(new.group_id,'poll_opened','נפתח סקר שבועי חדש','אפשר לבחור עכשיו באילו ימים אתם זמינים','poll',new.id);return new;end $$;
drop trigger if exists notify_poll_created on public.weekly_polls;create trigger notify_poll_created after insert on public.weekly_polls for each row execute function public.notify_new_poll();
create or replace function public.notify_new_match() returns trigger language plpgsql security definer set search_path=public as $$begin if new.status='registration_open' and (tg_op='INSERT' or old.status is distinct from new.status) then perform public.notify_group(new.group_id,'registration_open','נפתחה הרשמה למשחק',new.title||' · '||new.match_date::text,'match',new.id);end if;return new;end $$;
drop trigger if exists notify_match_opened on public.matches;create trigger notify_match_opened after insert or update on public.matches for each row execute function public.notify_new_match();

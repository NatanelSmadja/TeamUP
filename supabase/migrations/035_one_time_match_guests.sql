-- One-time match guests participate in the roster and team balancing without
-- becoming application users or affecting ratings, MVPs, goals or career stats.

create table public.match_guests (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 60),
  preferred_position text not null default 'utility'
    check (preferred_position in ('goalkeeper','defender','midfielder','winger','striker','utility')),
  balance_rating numeric(4,2) not null default 3.00 check (balance_rating between 1 and 5),
  attended boolean not null default true,
  attendance_marked_at timestamptz,
  attendance_marked_by uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index match_guests_unique_name_idx
on public.match_guests(match_id,lower(trim(display_name)));
create index match_guests_match_idx on public.match_guests(match_id,created_at);

alter table public.match_guests enable row level security;
create policy "match guests visible to group members"
on public.match_guests for select to authenticated using (
  exists (
    select 1 from public.matches m
    where m.id=match_guests.match_id
      and (public.is_group_member(m.group_id) or public.is_system_admin())
  )
);
revoke insert,update,delete on public.match_guests from anon,authenticated;
grant select on public.match_guests to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.match_guests;
exception when duplicate_object then null;
end $$;

-- A team slot belongs to exactly one registered user or one match guest.
alter table public.team_players alter column user_id drop not null;
alter table public.team_players add column guest_id uuid references public.match_guests(id) on delete cascade;
alter table public.team_players add constraint team_players_one_participant_check
  check ((user_id is not null)::int + (guest_id is not null)::int = 1);
create unique index team_players_team_guest_idx
  on public.team_players(team_id,guest_id) where guest_id is not null;

-- Preserve undo for both registered users and guests.
alter table public.team_edit_history alter column user_id drop not null;
alter table public.team_edit_history add column guest_id uuid references public.match_guests(id) on delete set null;
alter table public.team_edit_history add column team_player_id uuid references public.team_players(id) on delete set null;

-- Capacity is shared by confirmed members and guests. This trigger also protects
-- registration paths added before guests existed.
create or replace function public.enforce_match_capacity_with_guests()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_capacity integer;v_occupied integer;
begin
  if new.registration_status<>'confirmed' then return new; end if;
  select capacity into v_capacity from public.matches where id=new.match_id;
  select
    (select count(*) from public.match_registrations mr
      where mr.match_id=new.match_id and mr.registration_status='confirmed' and mr.id<>new.id)
    +(select count(*) from public.match_guests mg where mg.match_id=new.match_id)
  into v_occupied;
  if v_occupied>=v_capacity then
    new.registration_status:='waitlisted';
    new.queue_position:=null;
  end if;
  return new;
end $$;
revoke all on function public.enforce_match_capacity_with_guests() from public,anon,authenticated;

drop trigger if exists enforce_match_capacity_with_guests on public.match_registrations;
create trigger enforce_match_capacity_with_guests
before insert or update of registration_status on public.match_registrations
for each row execute function public.enforce_match_capacity_with_guests();

create or replace function public.manage_match_guest(
  p_match_id uuid,
  p_guest_id uuid default null,
  p_display_name text default null,
  p_position text default 'utility',
  p_balance_rating numeric default 3,
  p_remove boolean default false
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=(select auth.uid());v_match public.matches;v_guest public.match_guests;
  v_occupied integer;v_next public.match_registrations;v_name text;
begin
  if v_actor is null then raise exception 'יש להתחבר מחדש למערכת'; end if;
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not (public.has_group_permission(v_match.group_id,'manage_registrations') or public.is_system_admin()) then
    raise exception 'אין הרשאה לנהל את רשימת המשחק';
  end if;
  if v_match.ratings_open or v_match.status not in ('registration_open','registration_closed') then
    raise exception 'ניתן לנהל שחקנים אורחים רק לפני פרסום הקבוצות';
  end if;

  if p_remove then
    select * into v_guest from public.match_guests where id=p_guest_id and match_id=p_match_id for update;
    if not found then raise exception 'השחקן האורח לא נמצא'; end if;
    v_name:=v_guest.display_name;
    delete from public.match_guests where id=v_guest.id;
    if v_match.auto_promote_waitlist then
      select * into v_next from public.match_registrations
      where match_id=p_match_id and registration_status='waitlisted'
      order by registered_at,id for update skip locked limit 1;
      if found then
        update public.match_registrations set registration_status='confirmed',promoted_at=now(),queue_position=null where id=v_next.id;
        insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
        values(v_next.user_id,'waitlist_promoted','נכנסת למשחק','התפנה מקום ונכנסת אוטומטית לרשימה הראשית','match',p_match_id);
      end if;
    end if;
    with ranked as (
      select id,row_number() over(order by registered_at,id) rn from public.match_registrations
      where match_id=p_match_id and registration_status='waitlisted'
    ) update public.match_registrations mr set queue_position=ranked.rn from ranked where mr.id=ranked.id;
    perform public.log_group_audit(v_match.group_id,'match.guest_removed','match_guest',v_guest.id,to_jsonb(v_guest),null);
    return jsonb_build_object('removed',true,'guest_id',v_guest.id,'display_name',v_name);
  end if;

  v_name:=trim(coalesce(p_display_name,''));
  if char_length(v_name)<2 or char_length(v_name)>60 then raise exception 'יש להזין שם באורך 2 עד 60 תווים'; end if;
  if p_position not in ('goalkeeper','defender','midfielder','winger','striker','utility') then raise exception 'העמדה שנבחרה אינה תקינה'; end if;
  if p_balance_rating is null or p_balance_rating<1 or p_balance_rating>5 then raise exception 'רמת האיזון חייבת להיות בין 1 ל־5'; end if;
  select
    (select count(*) from public.match_registrations where match_id=p_match_id and registration_status='confirmed')
    +(select count(*) from public.match_guests where match_id=p_match_id)
  into v_occupied;
  if v_occupied>=v_match.capacity then raise exception 'רשימת המשחק מלאה; יש להסיר משתתף לפני הוספת אורח'; end if;

  insert into public.match_guests(match_id,display_name,preferred_position,balance_rating,created_by)
  values(p_match_id,v_name,p_position,p_balance_rating,v_actor) returning * into v_guest;
  perform public.log_group_audit(v_match.group_id,'match.guest_added','match_guest',v_guest.id,null,to_jsonb(v_guest));
  return jsonb_build_object('removed',false,'guest_id',v_guest.id,'display_name',v_guest.display_name);
exception when unique_violation then
  raise exception 'כבר קיים במשחק אורח בשם הזה';
end $$;
revoke all on function public.manage_match_guest(uuid,uuid,text,text,numeric,boolean) from public,anon;
grant execute on function public.manage_match_guest(uuid,uuid,text,text,numeric,boolean) to authenticated;

create or replace function public.set_match_guest_attendance(p_match_id uuid,p_guest_id uuid,p_attended boolean)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=(select auth.uid());v_match public.matches;
begin
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if v_match.created_by<>v_actor and not public.has_group_permission(v_match.group_id,'open_ratings') then
    raise exception 'אין הרשאה לעדכן נוכחות';
  end if;
  if v_match.ratings_open or v_match.status in ('completed','cancelled') then raise exception 'לא ניתן לשנות נוכחות לאחר סיום המשחק'; end if;
  update public.match_guests set attended=p_attended,attendance_marked_at=now(),attendance_marked_by=v_actor
  where id=p_guest_id and match_id=p_match_id;
  if not found then raise exception 'השחקן האורח לא נמצא'; end if;
end $$;
revoke all on function public.set_match_guest_attendance(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_match_guest_attendance(uuid,uuid,boolean) to authenticated;

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
  v_team_count:=greatest(2,least(4,v_match.team_count,v_count,
    greatest(2,round(v_count::numeric/greatest(v_match.team_size,1))::int)));
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
      select null::uuid,mg.id,mg.balance_rating,mg.preferred_position from public.match_guests mg where mg.match_id=p_match_id
    ) x
    order by (x.preferred_position='goalkeeper') desc,x.rating desc,random()
  loop
    idx:=case when (i/v_team_count)::int%2=0 then (i%v_team_count)+1 else v_team_count-(i%v_team_count) end;
    insert into public.team_players(team_id,user_id,guest_id,assigned_position,is_goalkeeper)
    values(v_team_ids[idx],rec.user_id,rec.guest_id,rec.preferred_position,rec.preferred_position='goalkeeper');
    i:=i+1;
  end loop;
  update public.matches set status='teams_published',team_count=v_team_count where id=p_match_id;
  update public.teams set is_published=true where match_id=p_match_id and generation_version=v_version;
end $$;
revoke all on function public.generate_balanced_teams(uuid) from public,anon;
grant execute on function public.generate_balanced_teams(uuid) to authenticated;

create or replace function public.get_member_match_details(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_match public.matches;v_user uuid:=(select auth.uid());v_registrations jsonb;v_guests jsonb;v_teams jsonb;
begin
  if v_user is null then raise exception 'יש להתחבר מחדש למערכת'; end if;
  select * into v_match from public.matches where id=p_match_id;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not public.is_system_admin() and not exists(
    select 1 from public.group_members gm where gm.group_id=v_match.group_id and gm.user_id=v_user and gm.status='active'
  ) then raise exception 'אין לך גישה למשחק הזה'; end if;
  select coalesce(jsonb_agg(to_jsonb(mr)||jsonb_build_object('profiles',to_jsonb(p)) order by mr.registered_at),'[]'::jsonb)
  into v_registrations from public.match_registrations mr join public.profiles p on p.id=mr.user_id where mr.match_id=p_match_id;
  select coalesce(jsonb_agg(to_jsonb(mg) order by mg.created_at),'[]'::jsonb)
  into v_guests from public.match_guests mg where mg.match_id=p_match_id;
  select coalesce(jsonb_agg(
    to_jsonb(t)||jsonb_build_object('team_players',coalesce((
      select jsonb_agg(to_jsonb(tp)||jsonb_build_object('profiles',to_jsonb(p),'guest',to_jsonb(mg)) order by tp.id)
      from public.team_players tp
      left join public.profiles p on p.id=tp.user_id
      left join public.match_guests mg on mg.id=tp.guest_id
      where tp.team_id=t.id
    ),'[]'::jsonb)) order by t.generation_version desc,t.team_number
  ),'[]'::jsonb) into v_teams from public.teams t where t.match_id=p_match_id and t.is_published=true;
  return jsonb_build_object('match',to_jsonb(v_match),'regs',v_registrations,'guests',v_guests,'teams',v_teams);
end $$;
revoke all on function public.get_member_match_details(uuid) from public,anon;
grant execute on function public.get_member_match_details(uuid) to authenticated;

create or replace function public.toggle_team_participant_lock(p_match_id uuid,p_team_player_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_match public.matches;v_new boolean;
begin
  select m.* into v_match from public.matches m where m.id=p_match_id;
  if not found or not (public.has_group_permission(v_match.group_id,'edit_teams') or public.has_group_permission(v_match.group_id,'generate_teams')) then raise exception 'אין הרשאה לעריכת קבוצות'; end if;
  update public.team_players tp set is_locked=not tp.is_locked
  where tp.id=p_team_player_id and exists(select 1 from public.teams t where t.id=tp.team_id and t.match_id=p_match_id and t.is_published)
  returning is_locked into v_new;
  if v_new is null then raise exception 'המשתתף לא נמצא בחלוקה הפעילה'; end if;
  return v_new;
end $$;
revoke all on function public.toggle_team_participant_lock(uuid,uuid) from public,anon;
grant execute on function public.toggle_team_participant_lock(uuid,uuid) to authenticated;

create or replace function public.move_team_participant(p_match_id uuid,p_team_player_id uuid,p_target_team_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_match public.matches;v_player public.team_players;v_batch uuid:=gen_random_uuid();
begin
  select * into v_match from public.matches where id=p_match_id;
  if not found or not (public.has_group_permission(v_match.group_id,'edit_teams') or public.has_group_permission(v_match.group_id,'generate_teams')) then raise exception 'אין הרשאה לעריכת קבוצות'; end if;
  if not exists(select 1 from public.teams where id=p_target_team_id and match_id=p_match_id and is_published) then raise exception 'קבוצת היעד אינה בחלוקה הפעילה'; end if;
  select tp.* into v_player from public.team_players tp join public.teams t on t.id=tp.team_id
  where tp.id=p_team_player_id and t.match_id=p_match_id and t.is_published;
  if not found then raise exception 'המשתתף לא נמצא בקבוצות'; end if;
  if v_player.is_locked then raise exception 'המשתתף נעול'; end if;
  if v_player.team_id=p_target_team_id then return; end if;
  insert into public.team_edit_history(match_id,batch_id,user_id,guest_id,team_player_id,from_team_id,to_team_id,performed_by)
  values(p_match_id,v_batch,v_player.user_id,v_player.guest_id,v_player.id,v_player.team_id,p_target_team_id,auth.uid());
  update public.team_players set team_id=p_target_team_id where id=v_player.id;
end $$;
revoke all on function public.move_team_participant(uuid,uuid,uuid) from public,anon;
grant execute on function public.move_team_participant(uuid,uuid,uuid) to authenticated;

create or replace function public.swap_team_participants(p_match_id uuid,p_first_player uuid,p_second_player uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_match public.matches;v_first public.team_players;v_second public.team_players;v_batch uuid:=gen_random_uuid();
begin
  select * into v_match from public.matches where id=p_match_id;
  if not found or not (public.has_group_permission(v_match.group_id,'edit_teams') or public.has_group_permission(v_match.group_id,'generate_teams')) then raise exception 'אין הרשאה לעריכת קבוצות'; end if;
  select tp.* into v_first from public.team_players tp join public.teams t on t.id=tp.team_id where tp.id=p_first_player and t.match_id=p_match_id and t.is_published;
  select tp.* into v_second from public.team_players tp join public.teams t on t.id=tp.team_id where tp.id=p_second_player and t.match_id=p_match_id and t.is_published;
  if v_first.id is null or v_second.id is null then raise exception 'אחד המשתתפים לא נמצא בחלוקה'; end if;
  if v_first.is_locked or v_second.is_locked then raise exception 'אחד המשתתפים נעול'; end if;
  if v_first.team_id=v_second.team_id then raise exception 'המשתתפים כבר באותה קבוצה'; end if;
  insert into public.team_edit_history(match_id,batch_id,user_id,guest_id,team_player_id,from_team_id,to_team_id,performed_by) values
    (p_match_id,v_batch,v_first.user_id,v_first.guest_id,v_first.id,v_first.team_id,v_second.team_id,auth.uid()),
    (p_match_id,v_batch,v_second.user_id,v_second.guest_id,v_second.id,v_second.team_id,v_first.team_id,auth.uid());
  update public.team_players set team_id=case when id=v_first.id then v_second.team_id else v_first.team_id end where id in(v_first.id,v_second.id);
end $$;
revoke all on function public.swap_team_participants(uuid,uuid,uuid) from public,anon;
grant execute on function public.swap_team_participants(uuid,uuid,uuid) to authenticated;

create or replace function public.undo_last_team_edit(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_group uuid;v_batch uuid;rec record;
begin
  select group_id into v_group from public.matches where id=p_match_id;
  if not (public.has_group_permission(v_group,'edit_teams') or public.has_group_permission(v_group,'generate_teams')) then raise exception 'אין הרשאה לעריכת קבוצות'; end if;
  select batch_id into v_batch from public.team_edit_history where match_id=p_match_id and undone_at is null order by created_at desc,id desc limit 1;
  if v_batch is null then raise exception 'אין שינוי שניתן לבטל'; end if;
  for rec in select * from public.team_edit_history where batch_id=v_batch order by id desc loop
    if rec.team_player_id is not null then
      update public.team_players set team_id=rec.from_team_id where id=rec.team_player_id;
    elsif rec.user_id is not null then
      update public.team_players tp set team_id=rec.from_team_id where tp.user_id=rec.user_id
      and exists(select 1 from public.teams t where t.id=tp.team_id and t.match_id=p_match_id and t.is_published);
    end if;
  end loop;
  update public.team_edit_history set undone_at=now() where batch_id=v_batch;
end $$;
revoke all on function public.undo_last_team_edit(uuid) from public,anon;
grant execute on function public.undo_last_team_edit(uuid) to authenticated;

-- Guests are intentionally excluded. They can help satisfy the minimum real-world
-- attendance needed to complete a match, but they never enter the rating graph.
create or replace function public.complete_match(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare m public.matches;v_end timestamp;v_attended integer;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not (public.is_match_result_manager(p_match_id) or public.has_group_permission(m.group_id,'open_ratings') or public.is_system_admin()) then raise exception 'אין הרשאה לסיים את המשחק'; end if;
  if m.ratings_open then raise exception 'הדירוג כבר פתוח'; end if;
  if m.status='completed' then return; end if;
  if m.status<>'teams_published' then raise exception 'יש לסגור הרשמה ולפרסם קבוצות לפני סיום המשחק'; end if;
  v_end:=case when m.end_time is null then m.match_date+m.start_time+interval '2 hours' when m.end_time<m.start_time then m.match_date+m.end_time+interval '1 day' else m.match_date+m.end_time end;
  if (clock_timestamp() at time zone 'Asia/Jerusalem')<v_end then raise exception 'ניתן לסיים את המשחק רק לאחר שעת הסיום'; end if;
  select
    (select count(*) from public.match_registrations where match_id=p_match_id and registration_status='confirmed' and attended=true)
    +(select count(*) from public.match_guests where match_id=p_match_id and attended=true)
  into v_attended;
  if v_attended<2 then raise exception 'יש לסמן לפחות שני משתתפים שנכחו לפני סיום המשחק'; end if;
  if exists(select 1 from public.goal_events where match_id=p_match_id and status='pending') then raise exception 'יש לטפל בכל דיווחי השערים לפני סיום המשחק'; end if;
  update public.matches set status='completed' where id=p_match_id;
  perform public.log_group_audit(m.group_id,'match.completed','match',p_match_id,to_jsonb(m),jsonb_build_object('status','completed'));
end $$;
revoke all on function public.complete_match(uuid) from public,anon;
grant execute on function public.complete_match(uuid) to authenticated;

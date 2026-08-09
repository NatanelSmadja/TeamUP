-- Real Web Push subscriptions and focused manager notifications.
-- The existing notifications table remains the single notification source.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  device_label text,
  enabled boolean not null default true,
  failure_count integer not null default 0 check(failure_count>=0),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_enabled_idx
  on public.push_subscriptions(user_id,enabled);

alter table public.push_subscriptions enable row level security;
drop policy if exists "users read own push subscriptions" on public.push_subscriptions;
drop policy if exists "users delete own push subscriptions" on public.push_subscriptions;
create policy "users read own push subscriptions" on public.push_subscriptions
  for select to authenticated using(user_id=(select auth.uid()));
create policy "users delete own push subscriptions" on public.push_subscriptions
  for delete to authenticated using(user_id=(select auth.uid()));

create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_expiration_time bigint default null,
  p_device_label text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=(select auth.uid());v_id uuid;
begin
  if v_user is null then raise exception 'יש להתחבר מחדש למערכת'; end if;
  if nullif(trim(p_endpoint),'') is null or length(p_endpoint)>4096 then raise exception 'כתובת Push אינה תקינה'; end if;
  if nullif(trim(p_p256dh),'') is null or length(p_p256dh)>1024 then raise exception 'מפתח Push אינו תקין'; end if;
  if nullif(trim(p_auth),'') is null or length(p_auth)>512 then raise exception 'אימות Push אינו תקין'; end if;

  insert into public.push_subscriptions(user_id,endpoint,p256dh,auth,expiration_time,device_label,enabled,failure_count,updated_at)
  values(v_user,trim(p_endpoint),trim(p_p256dh),trim(p_auth),p_expiration_time,left(nullif(trim(p_device_label),''),300),true,0,now())
  on conflict(endpoint) do update set
    user_id=excluded.user_id,
    p256dh=excluded.p256dh,
    auth=excluded.auth,
    expiration_time=excluded.expiration_time,
    device_label=excluded.device_label,
    enabled=true,
    failure_count=0,
    updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.unregister_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if (select auth.uid()) is null then raise exception 'יש להתחבר מחדש למערכת'; end if;
  delete from public.push_subscriptions
  where endpoint=p_endpoint and user_id=(select auth.uid());
end $$;

revoke all on function public.register_push_subscription(text,text,text,bigint,text) from public,anon;
revoke all on function public.unregister_push_subscription(text) from public,anon;
grant execute on function public.register_push_subscription(text,text,text,bigint,text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- Internal helper: admins/owners and explicitly delegated managers receive
-- operational notifications. The acting user is excluded to avoid self-noise.
create or replace function public.notify_group_managers(
  p_group_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_entity_type text,
  p_entity_id uuid,
  p_permissions text[] default array[]::text[],
  p_exclude_user uuid default null
) returns void language sql security definer set search_path=public as $$
  insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
  select distinct gm.user_id,p_type,p_title,p_message,p_entity_type,p_entity_id
  from public.group_members gm
  join public.groups g on g.id=gm.group_id
  where gm.group_id=p_group_id
    and gm.status='active'
    and gm.user_id is distinct from p_exclude_user
    and (
      gm.role='admin'
      or g.owner_id=gm.user_id
      or exists(
        select 1 from public.member_permissions mp
        where mp.group_member_id=gm.id and mp.permission_key=any(p_permissions)
      )
    )
$$;
revoke all on function public.notify_group_managers(uuid,text,text,text,text,uuid,text[],uuid) from public,anon,authenticated;

-- The poll creator already sees the result of their action and should not get
-- a redundant "new poll" notification about their own poll.
create or replace function public.notify_new_poll() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
  select gm.user_id,'poll_opened','נפתח סקר חדש: '||coalesce(nullif(new.title,''),'סקר זמינות'),
    'אפשר לבחור עכשיו באילו ימים אתם זמינים','poll',new.id
  from public.group_members gm
  where gm.group_id=new.group_id and gm.status='active' and gm.user_id<>new.created_by;
  return new;
end $$;
revoke all on function public.notify_new_poll() from public,anon,authenticated;

create or replace function public.notify_new_match() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status='registration_open' and (tg_op='INSERT' or old.status is distinct from new.status) then
    insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
    select gm.user_id,'registration_open','נפתחה הרשמה למשחק',new.title||' · '||new.match_date::text,'match',new.id
    from public.group_members gm
    where gm.group_id=new.group_id and gm.status='active' and gm.user_id<>new.created_by;
  end if;
  return new;
end $$;
revoke all on function public.notify_new_match() from public,anon,authenticated;

-- One manager alert per player/poll, even when a player selects several days.
create table if not exists public.poll_response_admin_events (
  poll_id uuid not null references public.weekly_polls(id) on delete cascade,
  responder_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(poll_id,responder_id)
);
alter table public.poll_response_admin_events enable row level security;

create or replace function public.toggle_weekly_availability(
  p_poll_id uuid,p_day integer default null,p_unavailable boolean default false
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=(select auth.uid());
  p public.weekly_polls;
  v_event_rows integer:=0;
  v_name text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select * into p from public.weekly_polls where id=p_poll_id;
  if not found or p.status<>'open' or not public.is_group_member(p.group_id) then raise exception 'הסקר אינו פתוח או שאין לך גישה'; end if;
  if (clock_timestamp() at time zone 'Asia/Jerusalem')::date>p.week_start+6 then raise exception 'ההצבעה עברה'; end if;

  if p_unavailable then
    delete from public.availability_votes where poll_id=p_poll_id and user_id=v_user
      and p.week_start+day_of_week>=(clock_timestamp() at time zone 'Asia/Jerusalem')::date;
    insert into public.weekly_poll_responses(poll_id,user_id,response,updated_at)
    values(p_poll_id,v_user,'unavailable',now())
    on conflict(poll_id,user_id) do update set response='unavailable',updated_at=now();
  else
    if p_day is null or p_day not between 0 and 6 then raise exception 'יום לא תקין'; end if;
    if (clock_timestamp() at time zone 'Asia/Jerusalem')::date>p.week_start+p_day then raise exception 'ההצבעה עברה'; end if;
    delete from public.weekly_poll_responses where poll_id=p_poll_id and user_id=v_user;
    if exists(select 1 from public.availability_votes where poll_id=p_poll_id and user_id=v_user and day_of_week=p_day) then
      delete from public.availability_votes where poll_id=p_poll_id and user_id=v_user and day_of_week=p_day;
    else
      insert into public.availability_votes(poll_id,user_id,day_of_week)
      values(p_poll_id,v_user,p_day) on conflict(poll_id,user_id,day_of_week) do nothing;
    end if;
  end if;

  if exists(select 1 from public.availability_votes where poll_id=p_poll_id and user_id=v_user)
     or exists(select 1 from public.weekly_poll_responses where poll_id=p_poll_id and user_id=v_user) then
    insert into public.poll_response_admin_events(poll_id,responder_id)
    values(p_poll_id,v_user) on conflict do nothing;
    get diagnostics v_event_rows=row_count;
    if v_event_rows>0 then
      select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'שחקן') into v_name
      from public.profiles where id=v_user;
      perform public.notify_group_managers(
        p.group_id,'poll_response_received',v_name||' ענה לסקר',
        'נשמרה תשובה חדשה לסקר '||coalesce(nullif(p.title,''),'סקר זמינות'),
        'poll',p.id,array['manage_polls','view_admin_alerts'],v_user
      );
    end if;
  end if;
end $$;
revoke all on function public.toggle_weekly_availability(uuid,integer,boolean) from public,anon;
grant execute on function public.toggle_weekly_availability(uuid,integer,boolean) to authenticated;

-- Notify match managers only on a real registration transition, not on repeated taps.
create or replace function public.respond_to_match(p_match_id uuid,p_response public.registration_response)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=(select auth.uid());v_match public.matches;v_count int;
  v_status public.registration_status;v_next public.match_registrations;
  v_old_response public.registration_response;v_old_status public.registration_status;v_name text;
begin
  if v_user is null then raise exception 'יש להתחבר מחדש למערכת'; end if;
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not exists(select 1 from public.group_members gm where gm.group_id=v_match.group_id and gm.user_id=v_user and gm.status='active') then
    raise exception 'רק חבר פעיל בקבוצה יכול להירשם למשחק';
  end if;
  if v_match.status<>'registration_open' then raise exception 'ההרשמה למשחק סגורה'; end if;

  select response,registration_status into v_old_response,v_old_status
  from public.match_registrations where match_id=p_match_id and user_id=v_user;
  select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'שחקן') into v_name
  from public.profiles where id=v_user;

  if p_response='attending' then
    select count(*) into v_count from public.match_registrations where match_id=p_match_id and registration_status='confirmed';
    v_status:=case when v_count<v_match.capacity then 'confirmed' else 'waitlisted' end;
    insert into public.match_registrations(match_id,user_id,response,registration_status,queue_position,registered_at,cancelled_at,attended,attendance_marked_at,attendance_marked_by)
    values(p_match_id,v_user,'attending',v_status,case when v_status='waitlisted' then v_count-v_match.capacity+1 else null end,now(),null,false,null,null)
    on conflict(match_id,user_id) do update set
      response='attending',registration_status=v_status,queue_position=excluded.queue_position,
      registered_at=now(),cancelled_at=null,attended=false,attendance_marked_at=null,attendance_marked_by=null;

    if coalesce(v_old_response,'no_response')<>'attending' or v_old_status not in ('confirmed','waitlisted') then
      perform public.notify_group_managers(
        v_match.group_id,'match_registration_added',v_name||' נרשם למשחק',
        case when v_status='waitlisted' then 'השחקן נכנס לרשימת ההמתנה של ' else 'השחקן הצטרף אל ' end||v_match.title,
        'match',v_match.id,array['manage_registrations','create_match','view_admin_alerts'],v_user
      );
    end if;
  else
    update public.match_registrations
    set response='unavailable',registration_status='cancelled',cancelled_at=now(),queue_position=null,
      attended=false,attendance_marked_at=null,attendance_marked_by=null
    where match_id=p_match_id and user_id=v_user;
    if not found then
      insert into public.match_registrations(match_id,user_id,response,registration_status,cancelled_at)
      values(p_match_id,v_user,'unavailable','cancelled',now());
    end if;

    if v_old_response='attending' and v_old_status in ('confirmed','waitlisted') then
      perform public.notify_group_managers(
        v_match.group_id,'match_registration_cancelled',v_name||' ביטל הגעה',
        'השחקן ביטל את ההרשמה ל־'||v_match.title,
        'match',v_match.id,array['manage_registrations','create_match','view_admin_alerts'],v_user
      );
    end if;

    if v_match.auto_promote_waitlist then
      select * into v_next from public.match_registrations
      where match_id=p_match_id and registration_status='waitlisted'
      order by registered_at for update skip locked limit 1;
      if found then
        update public.match_registrations set registration_status='confirmed',promoted_at=now(),queue_position=null where id=v_next.id;
        insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
        values(v_next.user_id,'waitlist_promoted','נכנסת למשחק','התפנה מקום ונכנסת אוטומטית לרשימה הראשית','match',p_match_id);
      end if;
    end if;
  end if;

  with ranked as(
    select id,row_number() over(order by registered_at) rn
    from public.match_registrations where match_id=p_match_id and registration_status='waitlisted'
  )
  update public.match_registrations mr set queue_position=ranked.rn
  from ranked where mr.id=ranked.id;
end $$;
revoke all on function public.respond_to_match(uuid,public.registration_response) from public,anon;
grant execute on function public.respond_to_match(uuid,public.registration_response) to authenticated;

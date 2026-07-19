-- TEAMUP V2.5: multiple polls per week + full poll management

alter table public.weekly_polls add column if not exists title text;
alter table public.weekly_polls add column if not exists description text;

update public.weekly_polls
set title = coalesce(nullif(title,''), 'סקר זמינות')
where title is null or title='';

alter table public.weekly_polls alter column title set default 'סקר זמינות';

-- Older versions allowed only one poll per group/week. Multiple games may need multiple polls.
alter table public.weekly_polls drop constraint if exists weekly_polls_group_id_week_start_key;

drop policy if exists "polls deleted by admins" on public.weekly_polls;
create policy "polls deleted by admins" on public.weekly_polls for delete to authenticated
using(public.is_group_admin(group_id));

-- Keep notifications descriptive when several polls are open.
create or replace function public.notify_new_poll() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 perform public.notify_group(
  new.group_id,
  'poll_opened',
  'נפתח סקר חדש: ' || coalesce(new.title,'סקר זמינות'),
  'אפשר לבחור עכשיו את הימים שמתאימים לכם',
  'poll',
  new.id
 );
 return new;
end $$;

-- Small helper for safe duplication from the UI.
create or replace function public.duplicate_weekly_poll(p_poll_id uuid,p_week_start date default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare src public.weekly_polls; new_id uuid;
begin
 select * into src from public.weekly_polls where id=p_poll_id;
 if not found or not public.is_group_admin(src.group_id) then raise exception 'אין הרשאה לשכפל את הסקר'; end if;
 insert into public.weekly_polls(group_id,created_by,week_start,status,title,description)
 values(src.group_id,auth.uid(),coalesce(p_week_start,src.week_start+7),'open',src.title,src.description)
 returning id into new_id;
 return new_id;
end $$;
grant execute on function public.duplicate_weekly_poll(uuid,date) to authenticated;

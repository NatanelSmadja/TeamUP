-- Prevent changes to availability days whose calendar date has already passed.

drop policy if exists "users add own votes" on public.availability_votes;
create policy "users add own votes" on public.availability_votes for insert to authenticated
with check(
 user_id=(select auth.uid()) and exists(
  select 1 from public.weekly_polls p where p.id=poll_id and p.status='open'
   and (clock_timestamp() at time zone 'Asia/Jerusalem')::date<=p.week_start+6 and (clock_timestamp() at time zone 'Asia/Jerusalem')::date<=p.week_start+day_of_week
   and public.is_group_member(p.group_id)
 )
);

drop policy if exists "users remove own votes" on public.availability_votes;
create policy "users remove own votes" on public.availability_votes for delete to authenticated
using(
 user_id=(select auth.uid()) and exists(
  select 1 from public.weekly_polls p where p.id=poll_id and p.status='open'
   and (clock_timestamp() at time zone 'Asia/Jerusalem')::date<=p.week_start+6 and (clock_timestamp() at time zone 'Asia/Jerusalem')::date<=p.week_start+availability_votes.day_of_week
   and public.is_group_member(p.group_id)
 )
);

drop policy if exists "users add own poll response" on public.weekly_poll_responses;
create policy "users add own poll response" on public.weekly_poll_responses for insert to authenticated
with check(user_id=(select auth.uid()) and exists(
 select 1 from public.weekly_polls p where p.id=poll_id and p.status='open'
  and (clock_timestamp() at time zone 'Asia/Jerusalem')::date<=p.week_start+6 and public.is_group_member(p.group_id)
));

drop policy if exists "users update own poll response" on public.weekly_poll_responses;
create policy "users update own poll response" on public.weekly_poll_responses for update to authenticated
using(user_id=(select auth.uid()) and exists(
 select 1 from public.weekly_polls p where p.id=poll_id and p.status='open'
  and (clock_timestamp() at time zone 'Asia/Jerusalem')::date<=p.week_start+6 and public.is_group_member(p.group_id)
)) with check(user_id=(select auth.uid()));

drop policy if exists "users remove own poll response" on public.weekly_poll_responses;
create policy "users remove own poll response" on public.weekly_poll_responses for delete to authenticated
using(user_id=(select auth.uid()) and exists(
 select 1 from public.weekly_polls p where p.id=poll_id and p.status='open'
  and (clock_timestamp() at time zone 'Asia/Jerusalem')::date<=p.week_start+6 and public.is_group_member(p.group_id)
));

create or replace function public.toggle_weekly_availability(p_poll_id uuid,p_day integer default null,p_unavailable boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=(select auth.uid());p public.weekly_polls;
begin
 if v_user is null then raise exception 'Not authenticated'; end if;
 select * into p from public.weekly_polls where id=p_poll_id;
 if not found or p.status<>'open' or not public.is_group_member(p.group_id) then raise exception 'הסקר אינו פתוח או שאין לך גישה'; end if;
 if (clock_timestamp() at time zone 'Asia/Jerusalem')::date>p.week_start+6 then raise exception 'ההצבעה עברה'; end if;
 if p_unavailable then
  delete from public.availability_votes where poll_id=p_poll_id and user_id=v_user
   and p.week_start+day_of_week>=(clock_timestamp() at time zone 'Asia/Jerusalem')::date;
  insert into public.weekly_poll_responses(poll_id,user_id,response,updated_at) values(p_poll_id,v_user,'unavailable',now())
  on conflict(poll_id,user_id) do update set response='unavailable',updated_at=now();
 else
  if p_day is null or p_day not between 0 and 6 then raise exception 'יום לא תקין'; end if;
  if (clock_timestamp() at time zone 'Asia/Jerusalem')::date>p.week_start+p_day then raise exception 'ההצבעה עברה'; end if;
  delete from public.weekly_poll_responses where poll_id=p_poll_id and user_id=v_user;
  if exists(select 1 from public.availability_votes where poll_id=p_poll_id and user_id=v_user and day_of_week=p_day) then
   delete from public.availability_votes where poll_id=p_poll_id and user_id=v_user and day_of_week=p_day;
  else
   insert into public.availability_votes(poll_id,user_id,day_of_week) values(p_poll_id,v_user,p_day)
   on conflict(poll_id,user_id,day_of_week) do nothing;
  end if;
 end if;
end $$;
grant execute on function public.toggle_weekly_availability(uuid,integer,boolean) to authenticated;

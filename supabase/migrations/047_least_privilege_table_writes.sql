-- Remove broad table mutations. Browser writes go through validated RPCs.

create or replace function public.create_weekly_poll_secure(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_week_start date
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=(select auth.uid());
  v_id uuid;
  v_title text:=regexp_replace(trim(coalesce(p_title,'')),'[[:space:]]+',' ','g');
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.has_group_permission(p_group_id,'manage_polls') then raise exception 'אין הרשאה לנהל סקרים'; end if;
  if p_week_start is null then raise exception 'תאריך הסקר נדרש'; end if;
  if v_title='' then v_title:='סקר זמינות'; end if;
  if char_length(v_title)>100 then raise exception 'שם הסקר ארוך מדי'; end if;
  insert into public.weekly_polls(group_id,created_by,title,description,week_start,status)
  values(p_group_id,v_user,v_title,nullif(trim(coalesce(p_description,'')),''),p_week_start,'open')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_weekly_poll_secure(
  p_poll_id uuid,
  p_title text default null,
  p_week_start date default null,
  p_status text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_poll public.weekly_polls;
  v_title text;
begin
  select * into v_poll from public.weekly_polls where id=p_poll_id for update;
  if not found then raise exception 'הסקר לא נמצא'; end if;
  if not public.has_group_permission(v_poll.group_id,'manage_polls') then raise exception 'אין הרשאה לנהל סקרים'; end if;
  if p_status is not null and p_status not in ('open','closed') then raise exception 'מצב הסקר אינו תקין'; end if;
  if p_title is not null then
    v_title:=regexp_replace(trim(p_title),'[[:space:]]+',' ','g');
    if v_title='' then v_title:='סקר זמינות'; end if;
    if char_length(v_title)>100 then raise exception 'שם הסקר ארוך מדי'; end if;
  end if;
  update public.weekly_polls set
    title=coalesce(v_title,title),
    week_start=coalesce(p_week_start,week_start),
    status=coalesce(p_status,status),
    closed_at=case
      when p_status='closed' then clock_timestamp()
      when p_status='open' then null
      else closed_at end
  where id=p_poll_id;
end;
$$;

create or replace function public.delete_weekly_poll_secure(p_poll_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v_group uuid;
begin
  select group_id into v_group from public.weekly_polls where id=p_poll_id for update;
  if not found then raise exception 'הסקר לא נמצא'; end if;
  if not public.has_group_permission(v_group,'manage_polls') then raise exception 'אין הרשאה לנהל סקרים'; end if;
  delete from public.weekly_polls where id=p_poll_id;
end;
$$;

revoke all on function public.create_weekly_poll_secure(uuid,text,text,date) from public,anon;
revoke all on function public.update_weekly_poll_secure(uuid,text,date,text) from public,anon;
revoke all on function public.delete_weekly_poll_secure(uuid) from public,anon;
grant execute on function public.create_weekly_poll_secure(uuid,text,text,date) to authenticated;
grant execute on function public.update_weekly_poll_secure(uuid,text,date,text) to authenticated;
grant execute on function public.delete_weekly_poll_secure(uuid) to authenticated;

revoke insert,update,delete,truncate,references,trigger on all tables in schema public from authenticated;
grant update(is_read) on public.notifications to authenticated;

alter default privileges in schema public
  revoke insert,update,delete,truncate,references,trigger on tables from authenticated;

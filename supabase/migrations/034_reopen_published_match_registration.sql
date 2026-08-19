-- Allow managers to safely undo an accidental team publication before kickoff.
-- Existing registrations and waitlist positions are intentionally preserved.

create or replace function public.reopen_published_match_registration(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_match public.matches;
begin
  select * into v_match
  from public.matches
  where id=p_match_id
  for update;

  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not (
    public.has_group_permission(v_match.group_id,'close_registration')
    or public.has_group_permission(v_match.group_id,'generate_teams')
    or public.is_system_admin()
  ) then
    raise exception 'אין הרשאה לפתוח מחדש את ההרשמה';
  end if;
  if v_match.ratings_open or v_match.status in ('completed','cancelled') then
    raise exception 'לא ניתן לפתוח מחדש משחק שהסתיים, בוטל או עבר לשלב הדירוג';
  end if;
  if v_match.status<>'teams_published' then
    raise exception 'ניתן לבטל את החלוקה רק לאחר פרסום הקבוצות';
  end if;
  if (clock_timestamp() at time zone 'Asia/Jerusalem') >= (v_match.match_date+v_match.start_time) then
    raise exception 'לא ניתן לפתוח מחדש את ההרשמה לאחר תחילת המשחק';
  end if;

  -- Keep the generated rows for audit/history, but remove them from every live view.
  update public.teams
  set is_published=false
  where match_id=p_match_id and is_published=true;

  update public.matches
  set status='registration_open'
  where id=p_match_id;

  perform public.log_group_audit(
    v_match.group_id,
    'match.registration_reopened_after_teams',
    'match',
    p_match_id,
    to_jsonb(v_match),
    jsonb_build_object('status','registration_open','published_teams_discarded',true)
  );
end;
$$;

revoke all on function public.reopen_published_match_registration(uuid) from public,anon;
grant execute on function public.reopen_published_match_registration(uuid) to authenticated;

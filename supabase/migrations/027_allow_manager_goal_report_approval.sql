-- A match result manager can already add an approved goal directly. Allow the
-- same manager to approve a pending report they submitted, while keeping the
-- operation unavailable to regular players.

create or replace function public.review_goal_report(p_goal_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=(select auth.uid());g public.goal_events;v_team uuid;m_status public.match_status;
begin
 select * into g from public.goal_events where id=p_goal_id for update;
 if not found then raise exception 'דיווח השער לא נמצא'; end if;
 if not public.is_match_result_manager(g.match_id) then raise exception 'אין הרשאה לטפל בדיווח'; end if;
 if g.status<>'pending' then raise exception 'הדיווח כבר טופל'; end if;
 select status into m_status from public.matches where id=g.match_id;
 if p_approve and m_status='cancelled' then raise exception 'לא ניתן לאשר שער במשחק שבוטל'; end if;
 if p_approve and not exists(
  select 1 from public.match_registrations
  where match_id=g.match_id and user_id=g.scorer_user_id
   and registration_status='confirmed' and attended=true
 ) then raise exception 'המבקיע אינו מסומן עוד כמשתתף במשחק'; end if;
 if p_approve then
  select tp.team_id into v_team
  from public.team_players tp join public.teams t on t.id=tp.team_id
  where t.match_id=g.match_id and t.is_published=true and tp.user_id=g.scorer_user_id
  order by t.generation_version desc limit 1;
 end if;
 update public.goal_events
 set status=case when p_approve then 'approved'::public.goal_event_status else 'rejected'::public.goal_event_status end,
  team_id=case when p_approve then v_team else team_id end,
  reviewed_by=v_user,reviewed_at=now()
 where id=p_goal_id;
end $$;

revoke all on function public.review_goal_report(uuid,boolean) from public,anon;
grant execute on function public.review_goal_report(uuid,boolean) to authenticated;

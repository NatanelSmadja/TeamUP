-- Full cross-group player card for system administrators only.

create or replace function public.system_admin_user_detail(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p public.profiles;v_groups jsonb;v_summary jsonb;
begin
 if not public.is_system_admin() then raise exception 'אין הרשאת מערכת'; end if;
 select * into p from public.profiles where id=p_user_id;
 if not found then raise exception 'המשתמש לא נמצא'; end if;

 select jsonb_build_object(
  'groups',count(distinct gm.group_id) filter(where gm.status='active' and g.lifecycle_status='active'),
  'games',count(distinct mr.match_id) filter(where mr.registration_status='confirmed' and mr.attended=true),
  'rating_count',(select count(*) from public.player_ratings pr where pr.rated_user_id=p_user_id),
  'avg_rating',coalesce((select round(avg(pr.overall_rating)::numeric,2) from public.player_ratings pr where pr.rated_user_id=p_user_id),p.base_rating,3),
  'mvp',(select count(*) from public.mvp_votes mv where mv.voted_user_id=p_user_id),
  'goals',(select count(*) from public.goal_events ge where ge.scorer_user_id=p_user_id and ge.status='approved')
 ) into v_summary
 from public.group_members gm join public.groups g on g.id=gm.group_id
 left join public.matches m on m.group_id=g.id
 left join public.match_registrations mr on mr.match_id=m.id and mr.user_id=p_user_id
 where gm.user_id=p_user_id;

 select coalesce(jsonb_agg(jsonb_build_object(
  'group_id',g.id,'name',g.name,'role',gm.role,'membership_status',gm.status,
  'group_status',g.lifecycle_status,'is_owner',g.owner_id=p_user_id,'joined_at',gm.joined_at,
  'games',(select count(*) from public.match_registrations mr join public.matches m on m.id=mr.match_id where m.group_id=g.id and mr.user_id=p_user_id and mr.registration_status='confirmed' and mr.attended=true),
  'rating_count',(select count(*) from public.player_ratings pr join public.matches m on m.id=pr.match_id where m.group_id=g.id and pr.rated_user_id=p_user_id),
  'avg_rating',coalesce((select round(avg(pr.overall_rating)::numeric,2) from public.player_ratings pr join public.matches m on m.id=pr.match_id where m.group_id=g.id and pr.rated_user_id=p_user_id),p.base_rating,3),
  'mvp',(select count(*) from public.mvp_votes mv join public.matches m on m.id=mv.match_id where m.group_id=g.id and mv.voted_user_id=p_user_id),
  'goals',(select count(*) from public.goal_events ge join public.matches m on m.id=ge.match_id where m.group_id=g.id and ge.scorer_user_id=p_user_id and ge.status='approved')
 ) order by (gm.status='active' and g.lifecycle_status='active') desc,gm.joined_at desc),'[]'::jsonb)
 into v_groups from public.group_members gm join public.groups g on g.id=gm.group_id where gm.user_id=p_user_id;

 return jsonb_build_object(
  'profile',jsonb_build_object(
   'id',p.id,'first_name',p.first_name,'last_name',p.last_name,'birth_date',p.birth_date,
   'preferred_position',p.preferred_position,'preferred_positions',p.preferred_positions,
   'secondary_position',p.secondary_position,'preferred_foot',p.preferred_foot,
   'avatar_url',p.avatar_url,'base_rating',p.base_rating,'is_system_admin',p.is_system_admin,
   'lifecycle_status',p.lifecycle_status,'created_at',p.created_at,'archived_at',p.archived_at
  ),'summary',v_summary,'groups',v_groups
 );
end $$;
revoke all on function public.system_admin_user_detail(uuid) from public,anon;
grant execute on function public.system_admin_user_detail(uuid) to authenticated;

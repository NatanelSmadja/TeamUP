-- Return the authenticated user's active group sessions through one reliable,
-- tenant-scoped source of truth. This avoids discrepancies between discovery
-- RPC results and nested PostgREST reads that are filtered independently by RLS.
-- The existing own-membership RLS policy is intentionally left untouched so
-- this migration can run safely while the application is serving reads.

create or replace function public.my_active_group_sessions()
returns setof jsonb
language sql
stable
security definer
set search_path=public
as $$
 select jsonb_build_object(
  'member',to_jsonb(gm),
  'group',to_jsonb(g),
  'permissions',coalesce(
   (select jsonb_agg(mp.permission_key order by mp.permission_key)
    from public.member_permissions mp
    where mp.group_member_id=gm.id),
   '[]'::jsonb
  )
 )
 from public.group_members gm
 join public.groups g on g.id=gm.group_id
 where gm.user_id=(select auth.uid())
   and gm.status='active'
   and g.lifecycle_status='active'
 order by gm.joined_at;
$$;

revoke all on function public.my_active_group_sessions() from public,anon;
grant execute on function public.my_active_group_sessions() to authenticated;

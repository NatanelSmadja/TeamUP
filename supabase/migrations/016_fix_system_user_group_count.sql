-- Count only memberships that are currently active and belong to active groups.
-- This replaces the function from migration 015 for databases where it was
-- already applied.

create or replace function public.system_admin_users(p_limit integer default 100,p_offset integer default 0)
returns table(
  user_id uuid,
  first_name text,
  last_name text,
  lifecycle_status text,
  is_system_admin boolean,
  group_count bigint,
  owned_group_count bigint,
  created_at timestamptz
)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_system_admin() then raise exception 'אין הרשאת מערכת'; end if;
  return query
  select p.id,p.first_name,p.last_name,p.lifecycle_status,p.is_system_admin,
    (select count(*)
     from public.group_members gm
     join public.groups g on g.id=gm.group_id
     where gm.user_id=p.id
       and gm.status='active'
       and g.lifecycle_status='active'),
    (select count(*) from public.groups g where g.owner_id=p.id and g.lifecycle_status<>'deleted'),
    p.created_at
  from public.profiles p
  order by p.created_at desc
  limit greatest(1,least(p_limit,200)) offset greatest(p_offset,0);
end $$;

grant execute on function public.system_admin_users(integer,integer) to authenticated;

-- TEAMUP V2.6: save signup positions and separate system admin from group managers

alter table public.profiles
  add column if not exists preferred_positions text[];

alter table public.profiles
  add column if not exists is_system_admin boolean not null default false;

-- Keep existing users compatible with the new multi-position field.
update public.profiles
set preferred_positions = array[coalesce(preferred_position, 'utility')]
where preferred_positions is null or cardinality(preferred_positions)=0;

-- The existing first/owner admin becomes the developer/system admin.
update public.profiles p
set is_system_admin = true
where exists (
  select 1
  from public.group_members gm
  where gm.user_id=p.id and gm.role='admin'
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  new_group uuid;
  first_user boolean;
  primary_position text;
  positions text[];
begin
  primary_position := coalesce(new.raw_user_meta_data->>'preferred_position','utility');

  begin
    select coalesce(array_agg(value), array[primary_position])
    into positions
    from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'preferred_positions', jsonb_build_array(primary_position))) as t(value);
  exception when others then
    positions := array[primary_position];
  end;

  if positions is null or cardinality(positions)=0 then
    positions := array[primary_position];
  end if;

  insert into public.profiles(
    id,first_name,last_name,birth_date,preferred_position,preferred_positions,preferred_foot
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name',''),
    coalesce(new.raw_user_meta_data->>'last_name',''),
    nullif(new.raw_user_meta_data->>'birth_date','')::date,
    primary_position,
    positions,
    coalesce(new.raw_user_meta_data->>'preferred_foot','right')::public.foot_type
  );

  select not exists(select 1 from public.groups) into first_user;
  if first_user then
    insert into public.groups(name,description,owner_id,default_location)
    values('הקבוצה שלנו','קבוצת גול טיים',new.id,'Gol Time')
    returning id into new_group;

    insert into public.group_members(group_id,user_id,role)
    values(new_group,new.id,'admin');

    update public.profiles set is_system_admin=true where id=new.id;
  else
    select id into new_group from public.groups order by created_at limit 1;
    insert into public.group_members(group_id,user_id,role)
    values(new_group,new.id,'player');
  end if;

  return new;
end
$$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce((select is_system_admin from public.profiles where id=(select auth.uid())),false);
$$;

grant execute on function public.is_system_admin() to authenticated;

-- Only the developer/system admin can grant or revoke permissions.
drop policy if exists "permissions managed" on public.member_permissions;
create policy "permissions managed by system admin"
on public.member_permissions
for all
to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

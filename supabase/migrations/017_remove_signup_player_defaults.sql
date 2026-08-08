-- New users must explicitly choose position and preferred foot. Keep profile
-- values empty when metadata is absent instead of silently assigning defaults.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  primary_position text;
  positions text[] := array[]::text[];
  foot_value text;
begin
  primary_position := nullif(trim(new.raw_user_meta_data->>'preferred_position'),'');
  if primary_position is not null and primary_position not in ('goalkeeper','defender','midfielder','winger','striker','utility') then
    primary_position := null;
  end if;

  begin
    select coalesce(array_agg(value),array[]::text[]) into positions
    from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'preferred_positions','[]'::jsonb)) t(value)
    where value in ('goalkeeper','defender','midfielder','winger','striker','utility');
  exception when others then
    positions := array[]::text[];
  end;

  if primary_position is not null and not (primary_position=any(positions)) then
    positions := array_prepend(primary_position,positions);
  end if;
  if primary_position is null and cardinality(positions)>0 then
    primary_position := positions[1];
  end if;

  foot_value := nullif(trim(new.raw_user_meta_data->>'preferred_foot'),'');
  if foot_value is not null and foot_value not in ('right','left','both') then
    foot_value := null;
  end if;

  insert into public.profiles(id,first_name,last_name,birth_date,preferred_position,preferred_positions,preferred_foot)
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name',''),
    coalesce(new.raw_user_meta_data->>'last_name',''),
    nullif(new.raw_user_meta_data->>'birth_date','')::date,
    primary_position,
    positions,
    foot_value::public.foot_type
  );
  return new;
end
$$;

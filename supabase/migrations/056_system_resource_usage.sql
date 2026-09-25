-- Read-only project measurements. Billing/account-wide usage is not available here.
create or replace function public.system_admin_resource_usage()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_buckets jsonb;
  v_database_bytes bigint;
begin
  if auth.uid() is null or not coalesce(public.is_system_admin(), false) then
    raise exception 'אין הרשאת מערכת' using errcode = '42501';
  end if;

  select sum(pg_catalog.pg_database_size(d.datname)) into v_database_bytes
  from pg_catalog.pg_database d;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'file_count', b.file_count, 'bytes', b.bytes,
    'unknown_size_count', b.unknown_size_count
  ) order by b.id), '[]'::jsonb) into v_buckets
  from (
    select bucket_id as id, count(*) as file_count,
      coalesce(sum(case when metadata->>'size' ~ '^[0-9]{1,18}$'
        then (metadata->>'size')::bigint else 0 end), 0) as bytes,
      count(*) filter (where coalesce(metadata->>'size' ~ '^[0-9]{1,18}$', false) = false) as unknown_size_count
    from storage.objects group by bucket_id
  ) b;

  return jsonb_build_object('measured_at', statement_timestamp(),
    'database_bytes', v_database_bytes, 'buckets', v_buckets);
end;
$$;
revoke all on function public.system_admin_resource_usage() from public, anon;
grant execute on function public.system_admin_resource_usage() to authenticated;

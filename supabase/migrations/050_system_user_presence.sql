-- Lightweight app presence. Users may only refresh their own heartbeat, while
-- the aggregate and recent-user list are available only to system admins.

create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create index if not exists user_presence_last_seen_idx
  on public.user_presence(last_seen_at desc);

alter table public.user_presence enable row level security;
revoke all on table public.user_presence from anon, authenticated;

create or replace function public.touch_user_presence()
returns timestamptz
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid := (select auth.uid());
  v_seen timestamptz := clock_timestamp();
begin
  if v_user is null then raise exception 'נדרשת התחברות'; end if;
  if not exists(select 1 from public.profiles where id=v_user and lifecycle_status='active') then
    raise exception 'נדרש חשבון פעיל';
  end if;

  insert into public.user_presence(user_id,last_seen_at)
  values(v_user,v_seen)
  on conflict(user_id) do update set last_seen_at=excluded.last_seen_at;

  return v_seen;
end $$;

revoke all on function public.touch_user_presence() from public,anon;
grant execute on function public.touch_user_presence() to authenticated;

create or replace function public.system_admin_presence()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if not public.is_system_admin() then raise exception 'אין הרשאת מערכת'; end if;

  return jsonb_build_object(
    'online_count',(
      select count(*)
      from public.user_presence presence
      join public.profiles profile on profile.id=presence.user_id
      where profile.lifecycle_status='active'
        and presence.last_seen_at>=v_now-interval '90 seconds'
    ),
    'recent_count',(
      select count(*)
      from public.user_presence presence
      join public.profiles profile on profile.id=presence.user_id
      where profile.lifecycle_status='active'
        and presence.last_seen_at>=v_now-interval '5 minutes'
    ),
    'users',coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id',recent.user_id,
        'first_name',recent.first_name,
        'last_name',recent.last_name,
        'last_seen_at',recent.last_seen_at,
        'is_online',recent.last_seen_at>=v_now-interval '90 seconds'
      ) order by recent.last_seen_at desc)
      from (
        select profile.id as user_id,profile.first_name,profile.last_name,presence.last_seen_at
        from public.user_presence presence
        join public.profiles profile on profile.id=presence.user_id
        where profile.lifecycle_status='active'
          and presence.last_seen_at>=v_now-interval '5 minutes'
        order by presence.last_seen_at desc
        limit 200
      ) recent
    ),'[]'::jsonb)
  );
end $$;

revoke all on function public.system_admin_presence() from public,anon;
grant execute on function public.system_admin_presence() to authenticated;

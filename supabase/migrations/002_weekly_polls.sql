-- TEAMUP weekly availability polls
do $$ begin
  create type public.poll_status as enum ('open','closed');
exception when duplicate_object then null;
end $$;

create table if not exists public.weekly_polls (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  week_start date not null,
  status public.poll_status not null default 'open',
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique(group_id,week_start)
);

create table if not exists public.availability_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.weekly_polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_of_week int not null check(day_of_week between 0 and 6),
  created_at timestamptz not null default now(),
  unique(poll_id,user_id,day_of_week)
);

alter table public.weekly_polls enable row level security;
alter table public.availability_votes enable row level security;

create policy "polls visible to group" on public.weekly_polls for select to authenticated
using(public.is_group_member(group_id));
create policy "polls created by admins" on public.weekly_polls for insert to authenticated
with check(public.is_group_admin(group_id) and created_by=(select auth.uid()));
create policy "polls updated by admins" on public.weekly_polls for update to authenticated
using(public.is_group_admin(group_id));

create policy "votes visible to group" on public.availability_votes for select to authenticated
using(exists(select 1 from public.weekly_polls p where p.id=poll_id and public.is_group_member(p.group_id)));
create policy "users add own votes" on public.availability_votes for insert to authenticated
with check(user_id=(select auth.uid()) and exists(select 1 from public.weekly_polls p where p.id=poll_id and p.status='open' and public.is_group_member(p.group_id)));
create policy "users remove own votes" on public.availability_votes for delete to authenticated
using(user_id=(select auth.uid()));

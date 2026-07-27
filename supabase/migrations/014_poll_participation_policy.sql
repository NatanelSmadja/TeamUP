-- Configurable consecutive missed-poll tracking per group.
alter table public.groups add column if not exists poll_miss_tracking_enabled boolean not null default false;
alter table public.groups add column if not exists poll_miss_alert_threshold integer not null default 2;
alter table public.groups drop constraint if exists groups_poll_miss_alert_threshold_check;
alter table public.groups add constraint groups_poll_miss_alert_threshold_check check (poll_miss_alert_threshold between 1 and 20);

-- A poll affects each member at most once, even if it is reopened and closed again.
create table if not exists public.poll_participation_counts (
  poll_id uuid not null references public.weekly_polls(id) on delete cascade,
  group_member_id uuid not null references public.group_members(id) on delete cascade,
  responded boolean not null,
  counted_at timestamptz not null default now(),
  primary key (poll_id, group_member_id)
);
alter table public.poll_participation_counts enable row level security;
drop policy if exists "poll participation visible to group admins" on public.poll_participation_counts;
create policy "poll participation visible to group admins" on public.poll_participation_counts
for select to authenticated using (
  exists (select 1 from public.group_members gm where gm.id=group_member_id and public.is_group_admin(gm.group_id))
);

create or replace function public.count_closed_poll_non_responses()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_member record; v_responded boolean; v_count integer; v_name text;
begin
  if new.status<>'closed' or old.status='closed' then return new; end if;
  if not exists(select 1 from public.groups g where g.id=new.group_id and g.poll_miss_tracking_enabled) then return new; end if;

  for v_member in
    select gm.id,gm.user_id from public.group_members gm
    where gm.group_id=new.group_id and gm.status='active' and gm.role='player'
  loop
    v_responded :=
      exists(select 1 from public.availability_votes av where av.poll_id=new.id and av.user_id=v_member.user_id)
      or exists(select 1 from public.weekly_poll_responses r where r.poll_id=new.id and r.user_id=v_member.user_id);

    insert into public.poll_participation_counts(poll_id,group_member_id,responded)
    values(new.id,v_member.id,v_responded) on conflict (poll_id,group_member_id) do nothing;
    if not found then continue; end if;

    update public.group_members gm
    set consecutive_no_responses=case when v_responded then 0 else gm.consecutive_no_responses+1 end
    where gm.id=v_member.id returning consecutive_no_responses into v_count;

    if not v_responded and v_count=(select g.poll_miss_alert_threshold from public.groups g where g.id=new.group_id) then
      select trim(concat_ws(' ',p.first_name,p.last_name)) into v_name from public.profiles p where p.id=v_member.user_id;
      insert into public.admin_alerts(group_id,user_id,type,message)
      values(new.group_id,v_member.user_id,'poll_miss_threshold',coalesce(nullif(v_name,''),'שחקן')||' לא ענה ל־'||v_count||' סקרים ברצף');
      insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
      select gm.user_id,'poll_miss_threshold','שחקן לא ענה לסקרים',
        coalesce(nullif(v_name,''),'שחקן')||' לא ענה ל־'||v_count||' סקרים ברצף. ניתן לבדוק ולהחליט אם להסיר אותו מהקבוצה.',
        'group',new.group_id
      from public.group_members gm
      where gm.group_id=new.group_id and gm.status='active' and gm.role='admin';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists count_closed_poll_non_responses_trigger on public.weekly_polls;
create trigger count_closed_poll_non_responses_trigger after update of status on public.weekly_polls
for each row execute function public.count_closed_poll_non_responses();

-- Disabling the feature discards old streaks, so re-enabling starts cleanly.
create or replace function public.reset_poll_miss_counts_when_disabled()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.poll_miss_tracking_enabled and not new.poll_miss_tracking_enabled then
    update public.group_members set consecutive_no_responses=0 where group_id=new.id and consecutive_no_responses<>0;
  end if;
  return new;
end $$;
drop trigger if exists reset_poll_miss_counts_when_disabled_trigger on public.groups;
create trigger reset_poll_miss_counts_when_disabled_trigger after update of poll_miss_tracking_enabled on public.groups
for each row execute function public.reset_poll_miss_counts_when_disabled();

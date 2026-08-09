-- Activity and notifications use polymorphic entity references, so they cannot
-- have a regular foreign key to matches. Remove stale references whenever a
-- match is deleted and clean references left by earlier deletions.

create or replace function public.cleanup_deleted_match_references()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
 delete from public.activity_events
 where entity_id=old.id and entity_type in ('match','rating');

 delete from public.notifications
 where entity_id=old.id and entity_type in ('match','rating');

 return old;
end $$;

drop trigger if exists cleanup_deleted_match_references_trigger on public.matches;
create trigger cleanup_deleted_match_references_trigger
after delete on public.matches
for each row execute function public.cleanup_deleted_match_references();

-- One-time cleanup for live activity and notifications whose match was already
-- deleted before this trigger existed.
delete from public.activity_events activity
where activity.entity_type in ('match','rating')
 and activity.entity_id is not null
 and not exists(select 1 from public.matches m where m.id=activity.entity_id);

delete from public.notifications notification
where notification.entity_type in ('match','rating')
 and notification.entity_id is not null
 and not exists(select 1 from public.matches m where m.id=notification.entity_id);

-- TEAMUP V5 - allow editing ratings/MVP and notify participants when rating opens
drop policy if exists "ratings update own" on public.player_ratings;
create policy "ratings update own" on public.player_ratings
for update to authenticated
using (rater_user_id=(select auth.uid()))
with check (rater_user_id=(select auth.uid()));

drop policy if exists "mvp update own" on public.mvp_votes;
create policy "mvp update own" on public.mvp_votes
for update to authenticated
using (voter_user_id=(select auth.uid()))
with check (voter_user_id=(select auth.uid()));

create or replace function public.notify_ratings_opened() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.ratings_open=true and coalesce(old.ratings_open,false)=false then
  insert into public.notifications(user_id,type,title,message,entity_type,entity_id)
  select mr.user_id,'ratings_open','הדירוג למשחק נפתח','אפשר לדרג עכשיו את שחקני המשחק ולבחור MVP','rating',new.id
  from public.match_registrations mr
  where mr.match_id=new.id and mr.registration_status='confirmed';
 end if;
 return new;
end $$;
drop trigger if exists notify_ratings_opened_trigger on public.matches;
create trigger notify_ratings_opened_trigger after update on public.matches
for each row execute function public.notify_ratings_opened();

-- Originals never reach Storage. One compressed object per user, <= 50 KiB.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-avatars','profile-avatars',true,51200,array['image/webp','image/jpeg'])
on conflict(id) do update set public=true,file_size_limit=51200,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "avatar owner read" on storage.objects;
create policy "avatar owner read" on storage.objects for select to authenticated
using(bucket_id='profile-avatars' and name=(select auth.uid())::text||'/avatar');
drop policy if exists "avatar owner insert" on storage.objects;
create policy "avatar owner insert" on storage.objects for insert to authenticated
with check(bucket_id='profile-avatars' and name=(select auth.uid())::text||'/avatar');
drop policy if exists "avatar owner update" on storage.objects;
create policy "avatar owner update" on storage.objects for update to authenticated
using(bucket_id='profile-avatars' and name=(select auth.uid())::text||'/avatar')
with check(bucket_id='profile-avatars' and name=(select auth.uid())::text||'/avatar');
drop policy if exists "avatar owner delete" on storage.objects;
create policy "avatar owner delete" on storage.objects for delete to authenticated
using(bucket_id='profile-avatars' and name=(select auth.uid())::text||'/avatar');

create or replace function public.set_own_profile_avatar(p_version uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());
begin
  if v_user is null then raise exception 'יש להתחבר כדי לעדכן תמונה'; end if;
  if p_version is not null and not exists(
    select 1 from storage.objects where bucket_id='profile-avatars' and name=v_user::text||'/avatar'
      and (metadata->>'size')::bigint between 1 and 51200
      and metadata->>'mimetype' in ('image/webp','image/jpeg')
  ) then raise exception 'יש להעלות תמונת פרופיל תקינה עד 50KB'; end if;
  -- Store a local Storage path, not a client-supplied external URL. The version
  -- changes only on upload, allowing browser caching without stale replacements.
  update public.profiles set avatar_url=case when p_version is null then null
    else v_user::text||'/avatar?v='||p_version::text end where id=v_user;
  if not found then raise exception 'הפרופיל לא נמצא'; end if;
end;
$$;
revoke all on function public.set_own_profile_avatar(uuid) from public,anon;
grant execute on function public.set_own_profile_avatar(uuid) to authenticated;
notify pgrst,'reload schema';

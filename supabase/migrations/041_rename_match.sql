-- Rename a match through a narrowly scoped, permission-checked operation.

create or replace function public.protect_match_title_update()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.title is distinct from old.title
    and not (public.has_group_permission(old.group_id,'edit_match') or public.is_system_admin()) then
    raise exception 'אין הרשאה לערוך את שם המשחק';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_match_title_update_trigger on public.matches;
create trigger protect_match_title_update_trigger
before update of title on public.matches
for each row execute function public.protect_match_title_update();
revoke all on function public.protect_match_title_update() from public,anon,authenticated;

create or replace function public.rename_match(p_match_id uuid,p_title text)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_match public.matches;
  v_title text:=regexp_replace(trim(coalesce(p_title,'')),'[[:space:]]+',' ','g');
begin
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'המשחק לא נמצא'; end if;
  if not (public.has_group_permission(v_match.group_id,'edit_match') or public.is_system_admin()) then
    raise exception 'אין הרשאה לערוך את שם המשחק';
  end if;
  if char_length(v_title)<2 then raise exception 'שם המשחק חייב להכיל לפחות 2 תווים'; end if;
  if char_length(v_title)>80 then raise exception 'שם המשחק יכול להכיל עד 80 תווים'; end if;

  if v_title<>v_match.title then
    update public.matches set title=v_title where id=p_match_id;
    perform public.log_group_audit(
      v_match.group_id,'match.renamed','match',p_match_id,
      jsonb_build_object('title',v_match.title),jsonb_build_object('title',v_title)
    );
  end if;
  return v_title;
end;
$$;

revoke all on function public.rename_match(uuid,text) from public,anon;
grant execute on function public.rename_match(uuid,text) to authenticated;

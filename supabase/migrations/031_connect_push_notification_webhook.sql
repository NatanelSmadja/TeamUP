-- Deliver every newly-created in-app notification to the Push Edge Function.
-- Runtime credentials are stored separately in Supabase Vault and are never
-- committed to this migration.

create extension if not exists pg_net with schema extensions;

create or replace function public.dispatch_push_notification_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  webhook_secret text;
  service_role_key text;
begin
  select decrypted_secret
    into webhook_secret
    from vault.decrypted_secrets
   where name = 'teamup_push_webhook_secret'
   limit 1;

  select decrypted_secret
    into service_role_key
    from vault.decrypted_secrets
   where name = 'teamup_push_service_role_key'
   limit 1;

  if webhook_secret is null or service_role_key is null then
    raise warning 'TEAMUP Push webhook credentials are not configured in Vault';
    return new;
  end if;

  perform net.http_post(
    url := 'https://gjyczxwmdonapjchpxhf.supabase.co/functions/v1/push-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key,
      'apikey', service_role_key,
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notifications',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', null
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

revoke all on function public.dispatch_push_notification_webhook() from public;

drop trigger if exists push_notifications_webhook on public.notifications;
create trigger push_notifications_webhook
after insert on public.notifications
for each row
execute function public.dispatch_push_notification_webhook();

comment on function public.dispatch_push_notification_webhook() is
  'Asynchronously forwards new in-app notifications to the TEAMUP Push Edge Function.';

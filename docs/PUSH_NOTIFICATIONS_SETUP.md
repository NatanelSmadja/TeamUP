# TEAMUP Web Push deployment

The application code, database schema and Edge Function are included in the repository. The following one-time infrastructure setup is required because private VAPID credentials must never be committed to Git.

## 1. Apply the database migration

Run `supabase/migrations/030_web_push_and_manager_notifications.sql` in the target Supabase project, or deploy all pending migrations with the normal project workflow.

## 2. Generate VAPID credentials

Generate one key pair for TEAMUP:

```bash
npx web-push generate-vapid-keys
```

Copy `supabase/functions/push-notifications/.env.example` to an ignored `.env` file in the same directory and fill in:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` — a valid `mailto:` address or HTTPS URL controlled by the site owner
- `PUSH_WEBHOOK_SECRET` — a long random value

The public and private VAPID keys must remain the same after launch. Replacing them invalidates existing device subscriptions.

## 3. Configure and deploy the Edge Function

```bash
npx supabase secrets set --env-file supabase/functions/push-notifications/.env --project-ref YOUR_PROJECT_REF
npx supabase functions deploy push-notifications --project-ref YOUR_PROJECT_REF
```

JWT verification should remain enabled. Signed-in users call the function only to retrieve the public VAPID key.

## 4. Create the notification database webhook

In Supabase Dashboard, create a Database Webhook with these settings:

- Table: `public.notifications`
- Event: `INSERT`
- Destination: Supabase Edge Function `push-notifications`
- Method: `POST`
- Authorization: service-role authorization offered by the Dashboard
- Additional header: `x-webhook-secret` with the exact `PUSH_WEBHOOK_SECRET` value

The function rejects notification-delivery calls without this private webhook header.

## 5. User flow

1. Deploy the web application so its Service Worker is active.
2. On iPhone/iPad, add TEAMUP to the Home Screen and open it from the icon. iOS 16.4 or newer is required.
3. Open Profile → Application and notifications → Enable notifications.
4. Accept the operating-system permission prompt.

Only the approved device is registered in `push_subscriptions`. Disabling notifications in the profile unsubscribes and removes that device. In-app notifications continue to work regardless of Push approval.

## Verification checklist

- Create a new poll: subscribed active group members receive Push; all members see the in-app notification.
- Answer a poll for the first time: subscribed admins/owners and delegated poll managers receive Push and an in-app manager notification.
- Register for or cancel a match: subscribed match managers receive the corresponding notification.
- Open match ratings: only subscribed attended players receive Push.
- Disable Push from one device: that device stops receiving Push while other approved devices continue.

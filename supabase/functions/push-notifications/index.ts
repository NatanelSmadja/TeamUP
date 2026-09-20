import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

const allowedOrigins = new Set([
  'https://teamup-rouge.vercel.app',
  'http://localhost:5173',
  ...(Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((value) => value.trim()).filter(Boolean),
]);

const corsHeadersFor = (request: Request) => {
  const origin = request.headers.get('origin');
  return {
    ...(origin && allowedOrigins.has(origin) ? {'Access-Control-Allow-Origin': origin} : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
};

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
};

async function notificationDestination(supabase: ReturnType<typeof createClient>, notification: NotificationRow) {
  let groupId: string | null = null;
  if (notification.entity_type === 'poll' && notification.entity_id) {
    const {data} = await supabase.from('weekly_polls').select('group_id').eq('id', notification.entity_id).maybeSingle();
    groupId = data?.group_id || null;
  } else if (['match', 'rating'].includes(notification.entity_type || '') && notification.entity_id) {
    const {data} = await supabase.from('matches').select('group_id').eq('id', notification.entity_id).maybeSingle();
    groupId = data?.group_id || null;
  } else if (notification.entity_type === 'group') {
    groupId = notification.entity_id;
  }

  const groupParam = groupId ? `group=${encodeURIComponent(groupId)}` : '';
  if (notification.type === 'group_join_request') return {url: `/group-settings${groupParam ? `?${groupParam}` : ''}`, groupId};
  if (notification.type === 'poll_miss_threshold') return {url: `/admin?tab=members${groupParam ? `&${groupParam}` : ''}`, groupId};
  if (['group_join_approved', 'group_join_rejected'].includes(notification.type)) return {url: '/groups', groupId};
  if (notification.entity_type === 'match' && notification.entity_id)
    return {url: `/matches/${notification.entity_id}${groupParam ? `?${groupParam}` : ''}`, groupId};
  if (notification.entity_type === 'poll')
    return {url: `/availability?${notification.entity_id ? `poll=${encodeURIComponent(notification.entity_id)}&` : ''}${groupParam}`, groupId};
  if (notification.entity_type === 'rating') return {url: `/ratings${groupParam ? `?${groupParam}` : ''}`, groupId};
  return {url: groupParam ? `/?${groupParam}` : '/', groupId};
}

Deno.serve(async (request) => {
  const corsHeaders = corsHeadersFor(request);
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {status, headers: {...corsHeaders, 'Content-Type': 'application/json'}});
  if (request.method === 'OPTIONS') {
    if (!corsHeaders['Access-Control-Allow-Origin']) return new Response('Forbidden origin', {status: 403, headers: corsHeaders});
    return new Response('ok', {headers: corsHeaders});
  }
  if (request.method !== 'POST') return respond({error: 'Method not allowed'}, 405);

  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@teamup.app';
  const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET');

  let body: any;
  try {
    body = await request.json();
  } catch {
    return respond({error: 'Invalid JSON'}, 400);
  }

  if (body?.action === 'public-key') {
    if (request.headers.get('origin') && !corsHeaders['Access-Control-Allow-Origin']) return respond({error: 'Forbidden origin'}, 403);
    if (!vapidPublicKey) return respond({error: 'Push is not configured'}, 503);
    return respond({publicKey: vapidPublicKey});
  }

  if (!webhookSecret || request.headers.get('x-webhook-secret') !== webhookSecret) return respond({error: 'Unauthorized webhook'}, 401);
  if (!vapidPublicKey || !vapidPrivateKey) return respond({error: 'VAPID keys are not configured'}, 503);

  const notification = body?.record as NotificationRow | undefined;
  if (body?.type !== 'INSERT' || body?.table !== 'notifications' || !notification?.id || !notification?.user_id) {
    return respond({error: 'Unsupported webhook payload'}, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return respond({error: 'Supabase service configuration is missing'}, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {auth: {persistSession: false}});

  const {data: subscriptions, error} = await supabase
    .from('push_subscriptions')
    .select('id,endpoint,p256dh,auth,failure_count')
    .eq('user_id', notification.user_id)
    .eq('enabled', true);
  if (error) return respond({error: 'Could not load push subscriptions'}, 500);
  if (!subscriptions?.length) return respond({sent: 0, reason: 'No approved devices'});

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const destination = await notificationDestination(supabase, notification);
  const payload = JSON.stringify({
    notificationId: notification.id,
    title: notification.title || 'TEAMUP',
    body: notification.message || '',
    tag: notification.id,
    url: destination.url,
    groupId: destination.groupId,
  });

  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {endpoint: subscription.endpoint, keys: {p256dh: subscription.p256dh, auth: subscription.auth}},
        payload,
        {TTL: 60 * 60 * 24, urgency: 'normal'},
      );
      sent += 1;
      await supabase.from('push_subscriptions').update({failure_count: 0, last_success_at: new Date().toISOString(), updated_at: new Date().toISOString()}).eq('id', subscription.id);
    } catch (sendError: any) {
      const statusCode = Number(sendError?.statusCode || sendError?.status || 0);
      if (statusCode === 404 || statusCode === 410) {
        removed += 1;
        await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
      } else {
        failed += 1;
        const failures = Number(subscription.failure_count || 0) + 1;
        await supabase.from('push_subscriptions').update({failure_count: failures, enabled: failures < 3, updated_at: new Date().toISOString()}).eq('id', subscription.id);
        console.error('Push delivery failed', {subscriptionId: subscription.id, statusCode, message: sendError?.message});
      }
    }
  }

  return respond({sent, removed, failed});
});

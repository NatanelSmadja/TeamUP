import {supabase} from './supabase';

const ENDPOINT_STORAGE_KEY = 'teamup_push_endpoint';

export type PushState = 'checking' | 'unsupported' | 'needs-install' | 'denied' | 'disabled' | 'enabled';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?: boolean}).standalone === true;

const urlBase64ToUint8Array = (value: string) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
};

const persistSubscription = async (subscription: PushSubscription) => {
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) throw new Error('המכשיר לא החזיר פרטי Push תקינים');
  const {error} = await supabase.rpc('register_push_subscription', {
    p_endpoint: serialized.endpoint,
    p_p256dh: serialized.keys.p256dh,
    p_auth: serialized.keys.auth,
    p_expiration_time: serialized.expirationTime || null,
    p_device_label: navigator.userAgent,
  });
  if (error) throw error;
  localStorage.setItem(ENDPOINT_STORAGE_KEY, serialized.endpoint);
};

export function pushSupportState(): PushState {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';
  return 'disabled';
}

export async function currentPushState(): Promise<PushState> {
  const support = pushSupportState();
  if (support !== 'disabled') return support;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 'disabled';
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? 'enabled' : 'disabled';
}

export async function enablePushNotifications() {
  const support = pushSupportState();
  if (support === 'unsupported') throw new Error('המכשיר או הדפדפן אינם תומכים בהתראות Push');
  if (support === 'needs-install') throw new Error('באייפון יש להוסיף קודם את TEAMUP למסך הבית ולפתוח אותה משם');
  if (support === 'denied') throw new Error('ההתראות חסומות בהגדרות המכשיר. יש לאפשר אותן בהגדרות ההתראות');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('לא ניתן אישור להתראות');

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) throw new Error('שירות ההתראות עדיין לא מוכן. נסה לסגור ולפתוח מחדש את האפליקציה');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const {data, error} = await supabase.functions.invoke('push-notifications', {body: {action: 'public-key'}});
    if (error || !data?.publicKey) throw new Error('שירות ההתראות עדיין לא הוגדר בשרת');
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
  }

  try {
    await persistSubscription(subscription);
  } catch (error) {
    await subscription.unsubscribe().catch(() => false);
    throw error;
  }
}

export async function disablePushNotifications() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  const endpoint = subscription?.endpoint || localStorage.getItem(ENDPOINT_STORAGE_KEY);
  let unregisterError: unknown;
  if (endpoint) {
    const {error} = await supabase.rpc('unregister_push_subscription', {p_endpoint: endpoint});
    unregisterError = error;
  }
  if (subscription) await subscription.unsubscribe();
  localStorage.removeItem(ENDPOINT_STORAGE_KEY);
  if (unregisterError) throw unregisterError;
}

export async function syncExistingPushSubscription() {
  if (pushSupportState() !== 'disabled' || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await persistSubscription(subscription);
}

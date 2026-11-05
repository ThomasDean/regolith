// Installable app and push notifications, browser side: registers the service worker
// (public/sw.js), turns "your move" alerts on and off for this device, and keeps the Home
// Screen badge equal to the number of online games waiting on you.
//
// On iPhone, Web Push and badges only work once Regolith is added to the Home Screen
// (Share → Add to Home Screen) and opened from there, on iOS 16.4 or later.
import { useCallback, useEffect, useState } from 'react';
import { cloudEnabled, sb } from './cloud';
import { allRooms, roomWaitsOn } from './shell/active';
import type { PushKeyReply } from './online/protocol';

/** Registers the offline/push service worker. Only on the deployed site, not in dev or the single-file build. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD || import.meta.env.MODE === 'single') return;
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is optional */ }); });
}

export const isStandalone = () =>
  (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true;

const isApple = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const bytes = (text: string): Uint8Array => {
  const t = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

// ---------------------------------------------------------------- badge

export function setBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) nav.setAppBadge?.(n)?.catch(() => {});
    else nav.clearAppBadge?.()?.catch(() => {});
  } catch { /* badges unsupported */ }
}

/** Sets the Home Screen badge to the number of your games that are waiting on you. */
export async function refreshBadge(uid: string) {
  try {
    const rooms = await allRooms();
    setBadge(rooms.filter((r) => roomWaitsOn(r, uid)).length);
  } catch { /* try again next time */ }
}

// ---------------------------------------------------------------- push

/**
 * 'install': on iPhone/iPad but not opened from the Home Screen yet; 'blocked': the player said
 * no in iOS settings; 'unavailable': this browser can't do it; 'off' / 'on': this device.
 */
export type PushState = 'unavailable' | 'install' | 'blocked' | 'off' | 'on';

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!cloudEnabled) return 'unavailable';
  if (isApple() && !isStandalone()) return 'install';
  if (!canPush()) return 'unavailable';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && (await currentSub()) ? 'on' : 'off';
}

async function saveSub(sub: PushSubscription) {
  const k = sub.toJSON().keys;
  if (!k?.p256dh || !k.auth) throw new Error('This device gave no push keys');
  const { error } = await sb().schema('regolith').rpc('save_push_subscription', {
    p_endpoint: sub.endpoint, p_p256dh: k.p256dh, p_auth: k.auth, p_user_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message);
}

async function serverKey(): Promise<Uint8Array> {
  const { data, error } = await sb().functions.invoke('regolith-play', { body: { op: 'push-key' } });
  const key = (data as PushKeyReply | null)?.key;
  if (error || !key) throw new Error('Turn alerts aren’t set up on the server yet.');
  return bytes(key);
}

/** Asks permission and subscribes this device. Call straight from a tap: iOS only asks then. */
export async function enablePush(): Promise<void> {
  if (!canPush()) throw new Error('This browser can’t show turn alerts.');
  const asked = await Notification.requestPermission(); // first, so the tap still counts as the player's
  if (asked !== 'granted') throw new Error('Notifications weren’t allowed. You can change that in your device’s settings.');
  const reg = await navigator.serviceWorker.ready;
  const key = await serverKey();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; } // the server's key changed
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
  await saveSub(sub);
}

const sameKey = (sub: PushSubscription, key: Uint8Array) => {
  const have = sub.options.applicationServerKey;
  if (!have) return true;
  const a = new Uint8Array(have);
  return a.length === key.length && a.every((v, i) => v === key[i]);
};

export async function disablePush(): Promise<void> {
  const sub = await currentSub();
  if (!sub) return;
  const { endpoint } = sub;
  await sub.unsubscribe();
  await sb().schema('regolith').rpc('delete_push_subscription', { p_endpoint: endpoint });
}

/** On launch: if alerts were turned on here, make sure the server still has this device under the signed-in player. */
async function syncPush() {
  try {
    if (!canPush() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) { // the subscription lapsed; permission is still granted, so renew without asking
      const key = await serverKey();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
    }
    await saveSub(sub);
  } catch { /* try again next launch */ }
}

/** The switch in the Online panel. */
export function usePushState(): [PushState | null, () => void] {
  const [state, setState] = useState<PushState | null>(null);
  const refresh = useCallback(() => { pushState().then(setState, () => setState('unavailable')); }, []);
  useEffect(refresh, [refresh]);
  return [state, refresh];
}

// ---------------------------------------------------------------- app-wide

/** The room id in a notification link (`/?room=ID`), if it is one and online play is set up. */
export const roomFromUrl = (href: string = location.href): string | null => {
  if (!cloudEnabled) return null;
  try {
    const id = new URL(href, location.origin).searchParams.get('room');
    return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch { return null; }
};

/**
 * Runs while a player is signed in: renews this device's push subscription, keeps the badge
 * right, and switches to a game when a notification is tapped while the app is open.
 */
export function usePwa(uid: string | undefined, openUrl: (url: string) => void) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'open-url') return;
      if (typeof e.data.url === 'string') openUrl(e.data.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [openUrl]);

  useEffect(() => {
    if (!uid || !cloudEnabled) return;
    syncPush();
    refreshBadge(uid);
    const wake = () => { if (document.visibilityState === 'visible') refreshBadge(uid); };
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, [uid]);
}

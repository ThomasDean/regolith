// Web Push without dependencies: payload encryption (RFC 8291, "aes128gcm" content coding,
// RFC 8188) and VAPID authentication (RFC 8292), both on WebCrypto, which Deno (Supabase Edge
// Functions) and Node both provide. Apple's push service for Home Screen web apps, Google's
// and Mozilla's all accept this.

export interface PushSub { endpoint: string; p256dh: string; auth: string }
export interface Vapid {
  /** the public key, base64url of the 65-byte uncompressed point (also what the browser subscribes with) */
  publicKey: string;
  /** the private scalar, base64url of 32 bytes */
  privateKey: string;
  /** a mailto: or https: contact for the push services */
  subject: string;
}
export interface PushMessage { title: string; body: string; tag?: string; url?: string; badge?: number }
export type PushResult = 'ok' | 'gone' | 'error';

const te = new TextEncoder();

/**
 * Only the browser makers' push services are ever contacted. Anyone can sign in as a guest and
 * register a subscription, so without this the server could be pointed at any web address.
 * (Keep in sync with the check on regolith.push_subscriptions.endpoint.)
 */
const SERVICES = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;
export const isPushServiceUrl = (url: string): boolean => url.length <= 2048 && SERVICES.test(url);

export const b64u = {
  enc(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(text: string): Uint8Array {
    const t = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, bytes * 8));
}

/** For tests: fixes the random parts of an encryption so it can be checked against RFC 8291's example. */
export interface Fixed { salt: Uint8Array; privateKey: CryptoKey; publicRaw: Uint8Array }

/** Encrypts `payload` for one subscription. Returns the request body (header block + one record). */
export async function encryptPayload(sub: PushSub, payload: Uint8Array, fixed?: Fixed): Promise<Uint8Array> {
  const uaPublic = b64u.dec(sub.p256dh);
  const authSecret = b64u.dec(sub.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('Bad subscription key');
  if (authSecret.length !== 16) throw new Error('Bad subscription auth secret');

  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (fixed) {
    asPrivate = fixed.privateKey;
    asPublic = fixed.publicRaw;
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));

  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  // RFC 8291 §3.4: mix the shared secret with the subscription's auth secret and both public keys
  const ikm = await hkdf(authSecret, shared, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  // RFC 8188 §2.2-2.3: content-encryption key and nonce from the salt
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);

  // one record: the message followed by the 0x02 "last record" delimiter
  const plain = concat(payload, new Uint8Array([2]));
  if (plain.length > 3993) throw new Error('Push message is too large');
  const key = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, plain as BufferSource));

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096); // record size
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

async function signingKey(v: Vapid): Promise<CryptoKey> {
  const pub = b64u.dec(v.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('Bad VAPID public key');
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), d: v.privateKey },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
}

/** The `Authorization` header value that proves to the push service that this server may send. */
export async function vapidAuthorization(endpoint: string, v: Vapid, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const part = (o: object) => b64u.enc(te.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: v.subject })}`;
  // WebCrypto signs ECDSA as the raw r||s pair, which is exactly what a JWT wants
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(v), te.encode(unsigned)));
  return `vapid t=${unsigned}.${b64u.enc(sig)}, k=${v.publicKey}`;
}

export interface SendOptions { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; fetch?: typeof fetch }

/** Sends one message. 'gone' means the device unsubscribed or the app was removed: forget it. */
export async function sendPush(sub: PushSub, msg: PushMessage, vapid: Vapid, opts: SendOptions = {}): Promise<PushResult> {
  if (!isPushServiceUrl(sub.endpoint)) return 'gone'; // not a real push address: forget it
  try {
    const body = await encryptPayload(sub, te.encode(JSON.stringify(msg)));
    const res = await (opts.fetch ?? fetch)(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, vapid),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(opts.ttl ?? 172800),
        Urgency: opts.urgency ?? 'high',
      },
      body: body as BodyInit,
    });
    if (res.ok) return 'ok';
    if (res.status === 404 || res.status === 410) return 'gone';
    console.error('push rejected', res.status, new URL(sub.endpoint).host, (await res.text().catch(() => '')).slice(0, 200));
    return 'error';
  } catch (e) {
    console.error('push failed', (e as Error).message);
    return 'error';
  }
}

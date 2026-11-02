import { describe, it, expect } from 'vitest';
import { createDecipheriv, createECDH, createPublicKey, createVerify, hkdfSync } from 'node:crypto';
import { b64u, encryptPayload, isPushServiceUrl, sendPush, vapidAuthorization, type Fixed, type PushSub, type Vapid } from '../server/push';

// RFC 8291 section 5 / appendix A: the worked example of an encrypted push message.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** What a browser does on receipt: the other half of the protocol, written with Node's crypto. */
function decrypt(body: Uint8Array, uaPrivate: Buffer, uaPublic: Buffer, auth: Buffer): string {
  const salt = Buffer.from(body.slice(0, 16));
  const idlen = body[20];
  const asPublic = Buffer.from(body.slice(21, 21 + idlen));
  const cipher = Buffer.from(body.slice(21 + idlen));
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
  return plain.subarray(0, plain.length - 1).toString();
}

function device() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub: PushSub = { endpoint: 'https://web.push.apple.com/abc123abc123abc123', p256dh: b64u.enc(ecdh.getPublicKey()), auth: b64u.enc(auth) };
  return { sub, priv: ecdh.getPrivateKey(), pub: ecdh.getPublicKey(), auth: Buffer.from(auth) };
}

async function vapidKeys(): Promise<Vapid> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: b64u.enc(pub), privateKey: jwk.d!, subject: 'https://regolith.example' };
}

describe('web push', () => {
  it('reproduces the example message in RFC 8291', async () => {
    const asPub = b64u.dec(RFC.asPublic);
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: b64u.enc(asPub.slice(1, 33)), y: b64u.enc(asPub.slice(33)), d: RFC.asPrivate },
      { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
    );
    const fixed: Fixed = { salt: b64u.dec(RFC.salt), privateKey, publicRaw: asPub };
    const out = await encryptPayload({ endpoint: 'https://push.example/x', p256dh: RFC.uaPublic, auth: RFC.auth }, new TextEncoder().encode(RFC.plaintext), fixed);
    expect(b64u.enc(out)).toBe(RFC.body);
  });

  it('encrypts a message the receiving device can read', async () => {
    const d = device();
    const msg = { title: 'Your turn', body: 'Generation 4 · with Ana' };
    const body = await encryptPayload(d.sub, new TextEncoder().encode(JSON.stringify(msg)));
    expect(JSON.parse(decrypt(body, d.priv, d.pub, d.auth))).toEqual(msg);
    // every message uses a fresh key and salt
    const again = await encryptPayload(d.sub, new TextEncoder().encode('x'));
    expect(Buffer.from(again.slice(0, 16)).equals(Buffer.from(body.slice(0, 16)))).toBe(false);
  });

  it('refuses malformed subscriptions and oversize messages', async () => {
    const d = device();
    await expect(encryptPayload({ ...d.sub, p256dh: 'AAAA' }, new Uint8Array(3))).rejects.toThrow(/key/);
    await expect(encryptPayload({ ...d.sub, auth: 'AAAA' }, new Uint8Array(3))).rejects.toThrow(/auth/);
    await expect(encryptPayload(d.sub, new Uint8Array(4000))).rejects.toThrow(/large/);
  });

  it('signs a VAPID token the push service can verify with the public key', async () => {
    const v = await vapidKeys();
    const header = await vapidAuthorization('https://web.push.apple.com/some/endpoint', v, 1_800_000_000);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)!;
    expect(m).toBeTruthy();
    expect(m[4]).toBe(v.publicKey);
    expect(JSON.parse(Buffer.from(m[1], 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(Buffer.from(m[2], 'base64url').toString())).toEqual({ aud: 'https://web.push.apple.com', exp: 1_800_000_000 + 43200, sub: v.subject });
    const pub = b64u.dec(v.publicKey);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33)) }, format: 'jwk' });
    const ok = createVerify('SHA256').update(`${m[1]}.${m[2]}`).verify({ key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
    expect(ok).toBe(true);
  });

  it('posts to the endpoint with the right headers, and reports dead devices', async () => {
    const d = device();
    const v = await vapidKeys();
    let seen: { url: string; headers: Record<string, string>; body: Uint8Array } | null = null;
    const reply = (status: number) => (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: init.body as Uint8Array };
      return new Response(null, { status });
    }) as unknown as typeof fetch;

    expect(await sendPush(d.sub, { title: 'Your turn', body: 'Gen 2', tag: 'room', url: '/?room=1', badge: 3 }, v, { fetch: reply(201) })).toBe('ok');
    expect(seen!.url).toBe(d.sub.endpoint);
    expect(seen!.headers['Content-Encoding']).toBe('aes128gcm');
    expect(seen!.headers.Urgency).toBe('high');
    expect(seen!.headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(JSON.parse(decrypt(seen!.body, d.priv, d.pub, d.auth))).toEqual({ title: 'Your turn', body: 'Gen 2', tag: 'room', url: '/?room=1', badge: 3 });

    expect(await sendPush(d.sub, { title: 'a', body: 'b' }, v, { fetch: reply(410) })).toBe('gone');
    expect(await sendPush(d.sub, { title: 'a', body: 'b' }, v, { fetch: reply(404) })).toBe('gone');
    expect(await sendPush(d.sub, { title: 'a', body: 'b' }, v, { fetch: reply(403) })).toBe('error');
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await sendPush(d.sub, { title: 'a', body: 'b' }, v, { fetch: boom })).toBe('error');
  });

  it('only ever contacts the real push services', async () => {
    for (const ok of ['https://web.push.apple.com/QGx', 'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://par02p.notify.windows.com/w/?token=x']) expect(isPushServiceUrl(ok)).toBe(true);
    for (const bad of ['http://web.push.apple.com/x', 'https://evil.example/x', 'https://web.push.apple.com.evil.example/x', 'https://evil.example/web.push.apple.com/', 'https://169.254.169.254/x', 'https://notpush.apple.com.evil/x']) expect(isPushServiceUrl(bad)).toBe(false);
    const d = device();
    let called = false;
    const spy = (async () => { called = true; return new Response(null, { status: 201 }); }) as unknown as typeof fetch;
    expect(await sendPush({ ...d.sub, endpoint: 'https://internal.example/hook' }, { title: 'a', body: 'b' }, await vapidKeys(), { fetch: spy })).toBe('gone');
    expect(called).toBe(false);
  });
});

// Makes the VAPID key pair that identifies this server to the phone makers' push services.
// Run once:  node scripts/vapid-keys.mjs
// Then store the three values as Supabase Edge Function secrets (README, "Push notifications").
// The private key is a secret: never commit it, and don't put it in a VITE_ variable.
import { webcrypto as crypto } from 'node:crypto';

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));

console.log(`VAPID_PUBLIC_KEY=${b64u(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log('VAPID_SUBJECT=https://regolith-wheat.vercel.app');

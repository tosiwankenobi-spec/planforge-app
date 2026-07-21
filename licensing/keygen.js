// Run once, for yourself: `node keygen.js`
// Produces private.pem (KEEP THIS SECRET — never send it to customers, never commit it)
// and public.pem (ship this inside server/keys/ — it can only verify keys, not create them).
import { generateKeyPairSync } from 'crypto';
import fs from 'fs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

fs.writeFileSync('private.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }));
fs.writeFileSync('public.pem', publicKey.export({ type: 'spki', format: 'pem' }));

console.log('Wrote private.pem and public.pem.');
console.log('Keep private.pem for yourself only. Copy public.pem into server/keys/public.pem.');

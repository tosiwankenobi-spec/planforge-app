// Run after each sale: `node issue-license.js customer@email.com`
// Signs a license key with your private key. Only someone holding private.pem
// (i.e. you) can produce a key that server/keys/public.pem will accept — customers
// can see the whole codebase and still can't mint their own valid key.
import { createPrivateKey, sign } from 'crypto';
import fs from 'fs';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node issue-license.js customer@email.com');
  process.exit(1);
}

const privateKey = createPrivateKey(fs.readFileSync(new URL('./private.pem', import.meta.url)));
const payload = JSON.stringify({ email, issuedAt: Date.now() });
const payloadB64 = Buffer.from(payload).toString('base64url');
const signature = sign(null, Buffer.from(payloadB64), privateKey).toString('base64url');
const licenseKey = `${payloadB64}.${signature}`;

console.log(`\nLicense key for ${email}:\n`);
console.log(licenseKey);
console.log('\nSend this to the customer. They paste it into the app on first run.');

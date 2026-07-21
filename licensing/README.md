# Licensing (for you, not customers)

One-time payment → one-time key that creates exactly one organization on your server.
Verification happens inside your own deployed `server/`, against a public key baked
into it — no separate licensing service to run or keep up.

## One-time setup
```
cd licensing
node keygen.js
```
Writes `private.pem` (keep it — back it up somewhere safe, never commit it, never share
it) and `public.pem`. Copy `public.pem` to `server/keys/public.pem` on the one server
you deploy.

## Selling
Collect payment however you like — Payment Link, Gumroad, Lemon Squeezy, PayPal. When a
payment comes in:
```
cd licensing
node issue-license.js customer@email.com
```
Send them the printed key. They open the app, choose "Create an organization," and
paste it in along with their org name, owner email/password, and their own Anthropic
API key. That key is now permanently spent — it can create exactly one organization,
enforced server-side by a `redeemed_licenses` table, not just by convention.

## Why this is safe to ship as source
`public.pem` can only verify signatures, not create them. Anyone reading the whole
codebase — including `server/keys/public.pem` — still can't mint a key that
`/api/orgs/activate` will accept, because that requires `private.pem`, which never
leaves your machine.

## If you want to automate this later
Wire `issue-license.js`'s logic into a webhook from whatever payment processor you use,
so keys generate and email themselves automatically. Not necessary to launch with.

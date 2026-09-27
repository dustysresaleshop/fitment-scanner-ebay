# Fitment Scanner + eBay Draft Push — Setup

## What's in this folder
- `index.html` — the scanner page (same as before, now with a "Push to eBay as Draft" button)
- `netlify/functions/` — the backend pieces that talk to eBay securely
- `netlify.toml` — tells Netlify where to find the functions

## Why this needs a different deploy method
Netlify Drop (drag-and-drop) only handles static files — it can't run the backend
functions. This project needs to be deployed by connecting a GitHub repo to Netlify
instead. One-time setup, then every future update is a normal `git push`.

## Setup order
1. **Get your eBay keys** — App ID (Client ID) and Cert ID (Client Secret) from
   developer.ebay.com, once your account/keyset is approved.
2. **Push this folder to a GitHub repo**, then connect that repo to a new Netlify site
   (Netlify → Add new site → Import from Git).
3. **Add environment variables** in Netlify (Site settings → Environment variables):
   - `EBAY_CLIENT_ID` — your App ID
   - `EBAY_CLIENT_SECRET` — your Cert ID
   - `EBAY_REDIRECT_URI` — the RuName from your eBay keyset (set this up in the eBay
     developer portal to point at `https://YOUR-SITE.netlify.app/.netlify/functions/ebay-auth-callback`)
   - `EBAY_ENV` — `sandbox` for now, `production` once you're ready to go live
   - `EBAY_MERCHANT_LOCATION_KEY` — `main-warehouse` (or any short name you like)
   - `EBAY_LOCATION_POSTAL_CODE` / `EBAY_LOCATION_COUNTRY` — your actual warehouse zip/country
4. **Redeploy** so the new env vars take effect.
5. **Visit** `https://YOUR-SITE.netlify.app/.netlify/functions/ebay-auth-start` once in
   a browser, log in with your (sandbox) eBay account, and approve access.
6. **Copy the refresh token** shown on the confirmation page, add it as
   `EBAY_REFRESH_TOKEN` in Netlify, and redeploy again.
7. **Visit** `https://YOUR-SITE.netlify.app/.netlify/functions/ebay-create-location`
   once to register your inventory location with eBay.
8. **Test the app** — scan or enter a part, generate the draft, click
   "Push to eBay as Draft."

## Likely next snag
eBay's `createOffer` call often rejects the first attempt with an error mentioning
"policy" — this means your (sandbox or real) eBay account needs Business Policies
(payment/fulfillment/return) opted into before it'll accept offers. That's a
one-time setting in Seller Hub, not a bug in this code. Come back once you see
that error and we'll wire the policy IDs in.

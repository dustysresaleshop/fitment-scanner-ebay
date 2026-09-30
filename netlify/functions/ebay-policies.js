// netlify/functions/ebay-policies.js
// Setup tool for eBay business policies (shipping, payment, returns).
//   /.netlify/functions/ebay-policies            -> checks access and lists your policies
//   /.netlify/functions/ebay-policies?create=1   -> creates a working test set
//   /.netlify/functions/ebay-policies?location=create&zip=12345&city=Town&state=OH
//                                                -> creates the item location your listings use
// Delete this file once your policies are set up.
const { tokenUrl, apiBase } = require('./utils/ebay-auth');

const ACCOUNT_SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account';

const reply = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj, null, 2)
});

// Ask for the account permission directly, so we can see if eBay refuses it
async function accountToken() {
  const rt = process.env.EBAY_REFRESH_TOKEN || '';
  const resp = await fetch(tokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, scope: ACCOUNT_SCOPES }).toString()
  });
  const data = await resp.json().catch(() => ({}));
  return {
    token: resp.ok ? data.access_token : null,
    check: resp.ok ? 'OK: token includes account permission' : `FAILED: ${data.error || resp.status} ${data.error_description || ''}`.trim(),
    refreshTokenEndsWith: rt ? rt.slice(-6) : '(not set)'
  };
}

async function call(base, token, method, path, body) {
  const resp = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Language': 'en-US',
      'Accept-Language': 'en-US'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { ok: resp.ok, status: resp.status, data, text: text.slice(0, 500) };
}

const errText = r => (r.data && r.data.errors)
  ? r.data.errors.map(e => `${e.errorId} ${e.message}`).join(' | ')
  : `${r.status} ${r.text}`;

async function listPolicies(base, token) {
  const q = '?marketplace_id=EBAY_US';
  const [f, p, r] = await Promise.all([
    call(base, token, 'GET', '/sell/account/v1/fulfillment_policy' + q),
    call(base, token, 'GET', '/sell/account/v1/payment_policy' + q),
    call(base, token, 'GET', '/sell/account/v1/return_policy' + q)
  ]);
  return {
    shipping: f.ok ? (f.data.fulfillmentPolicies || []).map(x => ({
      id: x.fulfillmentPolicyId,
      name: x.name,
      shippingServices: (x.shippingOptions || []).flatMap(o => (o.shippingServices || []).map(s => s.shippingServiceCode))
    })) : 'Error: ' + errText(f),
    payment: p.ok ? (p.data.paymentPolicies || []).map(x => ({ id: x.paymentPolicyId, name: x.name })) : 'Error: ' + errText(p),
    returns: r.ok ? (r.data.returnPolicies || []).map(x => ({ id: x.returnPolicyId, name: x.name })) : 'Error: ' + errText(r)
  };
}

exports.handler = async (event) => {
  let step = 'token';
  try {
    const base = apiBase();
    const sandbox = /sandbox/i.test(base);
    const env = {
      EBAY_FULFILLMENT_POLICY_ID: process.env.EBAY_FULFILLMENT_POLICY_ID || '(not set)',
      EBAY_PAYMENT_POLICY_ID: process.env.EBAY_PAYMENT_POLICY_ID || '(not set)',
      EBAY_RETURN_POLICY_ID: process.env.EBAY_RETURN_POLICY_ID || '(not set)'
    };

    const t = await accountToken();
    const diagnostics = { tokenCheck: t.check, refreshTokenEndsWith: t.refreshTokenEndsWith };
    if (!t.token) {
      return reply(200, { environment: sandbox ? 'sandbox' : 'production', diagnostics,
        next: 'The saved refresh token does not include the account permission. Get a new one from ebay-connect, save it in Netlify, and redeploy.' });
    }

    // Business policies must be switched on for the account (safe to repeat)
    step = 'opt_in';
    const optIn = await call(base, t.token, 'POST', '/sell/account/v1/program/opt_in', { programType: 'SELLING_POLICY_MANAGEMENT' });
    diagnostics.businessPoliciesOptIn = optIn.ok ? 'OK: signed up (or already signed up)' : 'Response: ' + errText(optIn);
    const programs = await call(base, t.token, 'GET', '/sell/account/v1/program/get_opted_in_programs');
    diagnostics.optedInPrograms = programs.ok
      ? (programs.data.programs || []).map(p => p.programType)
      : 'Error: ' + errText(programs);

    const qs = event.queryStringParameters || {};
    const locationKey = process.env.EBAY_MERCHANT_LOCATION_KEY || 'main-warehouse';

    if (qs.location === 'create') {
      step = 'create_location';
      const zip = String(qs.zip || '').trim(), city = String(qs.city || '').trim(), state = String(qs.state || '').trim().toUpperCase();
      if (!/^\d{5}$/.test(zip) || !city || !/^[A-Z]{2}$/.test(state)) {
        return reply(400, { message: 'Add your ZIP, city, and 2-letter state, like ?location=create&zip=12345&city=Yourtown&state=OH' });
      }
      const loc = await call(base, t.token, 'POST', `/sell/inventory/v1/location/${encodeURIComponent(locationKey)}`, {
        location: { address: { city, stateOrProvince: state, postalCode: zip, country: 'US' } },
        locationTypes: ['WAREHOUSE'],
        name: 'Main warehouse',
        merchantLocationStatus: 'ENABLED'
      });
      return reply(200, {
        environment: sandbox ? 'sandbox' : 'production',
        locationKey,
        result: (loc.ok || loc.status === 204) ? 'OK: location created' : 'Response: ' + errText(loc)
      });
    }

    if (qs.create !== '1') {
      step = 'list';
      const locs = await call(base, t.token, 'GET', '/sell/inventory/v1/location?limit=100');
      const locationKeys = locs.ok ? (locs.data.locations || []).map(l => l.merchantLocationKey) : 'Error: ' + errText(locs);
      return reply(200, {
        environment: sandbox ? 'sandbox' : 'production',
        diagnostics,
        currentNetlifySettings: env,
        policies: await listPolicies(base, t.token),
        itemLocation: {
          listingsUse: locationKey,
          existsOnAccount: Array.isArray(locationKeys) ? locationKeys.includes(locationKey) : 'unknown',
          allLocations: locationKeys
        }
      });
    }

    const categoryTypes = [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }];
    const created = {};

    step = 'create_shipping';
    const f = await call(base, t.token, 'POST', '/sell/account/v1/fulfillment_policy', {
      name: 'Fitment App Shipping',
      marketplaceId: 'EBAY_US',
      categoryTypes,
      handlingTime: { value: 2, unit: 'DAY' },
      shippingOptions: [{
        optionType: 'DOMESTIC',
        costType: 'FLAT_RATE',
        shippingServices: [{
          shippingCarrierCode: 'USPS',
          shippingServiceCode: 'USPSPriority',
          shippingCost: { value: '0.00', currency: 'USD' },
          freeShipping: true,
          sortOrder: 1
        }]
      }]
    });
    created.EBAY_FULFILLMENT_POLICY_ID = f.ok ? f.data.fulfillmentPolicyId : 'Error: ' + errText(f);

    step = 'create_payment';
    const p = await call(base, t.token, 'POST', '/sell/account/v1/payment_policy', {
      name: 'Fitment App Payment',
      marketplaceId: 'EBAY_US',
      categoryTypes,
      immediatePay: true
    });
    created.EBAY_PAYMENT_POLICY_ID = p.ok ? p.data.paymentPolicyId : 'Error: ' + errText(p);

    step = 'create_returns';
    const r = await call(base, t.token, 'POST', '/sell/account/v1/return_policy', {
      name: 'Fitment App Returns',
      marketplaceId: 'EBAY_US',
      categoryTypes,
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: 'DAY' },
      returnShippingCostPayer: 'BUYER'
    });
    created.EBAY_RETURN_POLICY_ID = r.ok ? r.data.returnPolicyId : 'Error: ' + errText(r);

    return reply(200, {
      environment: sandbox ? 'sandbox' : 'production',
      diagnostics,
      created,
      next: 'Copy each ID above into the matching Netlify environment variable, then redeploy.'
    });
  } catch (err) {
    return reply(500, { step, message: err.message });
  }
};

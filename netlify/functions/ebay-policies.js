// netlify/functions/ebay-policies.js
// Setup tool for eBay business policies (shipping, payment, returns).
//   /.netlify/functions/ebay-policies            -> lists your policies
//   /.netlify/functions/ebay-policies?create=1   -> creates a working test set
// Delete this file once your policies are set up.
const { getAccessToken, apiBase } = require('./utils/ebay-auth');

const reply = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj, null, 2)
});

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
    const token = await getAccessToken();
    const base = apiBase();
    const env = {
      EBAY_FULFILLMENT_POLICY_ID: process.env.EBAY_FULFILLMENT_POLICY_ID || '(not set)',
      EBAY_PAYMENT_POLICY_ID: process.env.EBAY_PAYMENT_POLICY_ID || '(not set)',
      EBAY_RETURN_POLICY_ID: process.env.EBAY_RETURN_POLICY_ID || '(not set)'
    };
    const sandbox = /sandbox/i.test(base);

    if ((event.queryStringParameters || {}).create !== '1') {
      step = 'list';
      return reply(200, { environment: sandbox ? 'sandbox' : 'production', currentNetlifySettings: env, policies: await listPolicies(base, token) });
    }

    // Business policies must be switched on for the account (safe to repeat)
    step = 'opt_in';
    await call(base, token, 'POST', '/sell/account/v1/program/opt_in', { programType: 'SELLING_POLICY_MANAGEMENT' });

    const categoryTypes = [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }];
    const created = {};

    step = 'create_shipping';
    const f = await call(base, token, 'POST', '/sell/account/v1/fulfillment_policy', {
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
    const p = await call(base, token, 'POST', '/sell/account/v1/payment_policy', {
      name: 'Fitment App Payment',
      marketplaceId: 'EBAY_US',
      categoryTypes,
      immediatePay: true
    });
    created.EBAY_PAYMENT_POLICY_ID = p.ok ? p.data.paymentPolicyId : 'Error: ' + errText(p);

    step = 'create_returns';
    const r = await call(base, token, 'POST', '/sell/account/v1/return_policy', {
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
      created,
      next: 'Copy each ID above into the matching Netlify environment variable, then redeploy.'
    });
  } catch (err) {
    return reply(500, { step, message: err.message });
  }
};

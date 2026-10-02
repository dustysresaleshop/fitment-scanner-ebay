// netlify/functions/ebay-publish-offer.js
// Takes an eBay draft (offer) live. Body: { "offerId": "1234567890" }
const { getAccessToken, apiBase } = require('./utils/ebay-auth');
const { requireAppKey } = require('./utils/app-auth');

const reply = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

function summarize(text) {
  try {
    const d = JSON.parse(text);
    if (d.errors && d.errors.length) {
      return d.errors.map(e => {
        const params = (e.parameters || []).map(p => `${p.name}=${p.value}`).join(', ');
        return `${e.errorId || ''} ${e.message || ''}${params ? ' [' + params + ']' : ''}`.trim();
      }).join(' | ');
    }
  } catch (e) {}
  return String(text).slice(0, 300);
}

exports.handler = async (event) => {
  const denied = requireAppKey(event);   // app password check
  if (denied) return denied;

  if (event.httpMethod !== 'POST') return reply(405, { message: 'Use POST.' });
  let step = 'start';
  try {
    const { offerId } = JSON.parse(event.body || '{}');
    if (!offerId || !/^\d+$/.test(String(offerId))) {
      return reply(400, { step, message: 'Missing or invalid offerId.' });
    }

    step = 'token';
    const accessToken = await getAccessToken();
    const base = apiBase();

    const jsonHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Language': 'en-US',
      'Accept-Language': 'en-US'
    };

    // Make the draft use your current policies (from Netlify) before going live,
    // so a policy change doesn't require pushing the part again
    step = 'refresh_policies';
    let offerSku = null;
    const wanted = {};
    if (process.env.EBAY_FULFILLMENT_POLICY_ID) wanted.fulfillmentPolicyId = process.env.EBAY_FULFILLMENT_POLICY_ID;
    if (process.env.EBAY_PAYMENT_POLICY_ID) wanted.paymentPolicyId = process.env.EBAY_PAYMENT_POLICY_ID;
    if (process.env.EBAY_RETURN_POLICY_ID) wanted.returnPolicyId = process.env.EBAY_RETURN_POLICY_ID;
    if (Object.keys(wanted).length) {
      const g = await fetch(`${base}/sell/inventory/v1/offer/${offerId}`, { headers: jsonHeaders });
      if (g.ok) {
        const offer = await g.json();
        offerSku = offer.sku || null;
        const have = offer.listingPolicies || {};
        const differs = Object.keys(wanted).some(k => have[k] !== wanted[k]);
        if (differs) {
          // Send back only the fields eBay accepts when updating an offer
          const keep = ['availableQuantity', 'categoryId', 'listingDescription', 'merchantLocationKey', 'pricingSummary',
            'quantityLimitPerBuyer', 'secondaryCategoryId', 'storeCategoryNames', 'tax', 'listingDuration',
            'includeCatalogProductDetails', 'hideBuyerDetails', 'lotSize', 'charity', 'extendedProducerResponsibility'];
          const body = {};
          keep.forEach(k => { if (offer[k] !== undefined) body[k] = offer[k]; });
          body.listingPolicies = Object.assign({}, have, wanted);
          const u = await fetch(`${base}/sell/inventory/v1/offer/${offerId}`, {
            method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body)
          });
          if (!u.ok && u.status !== 204) return reply(u.status, { step, message: summarize(await u.text()) });
        }
      }
    }

    step = 'publish';
    const doPublish = () => fetch(`${base}/sell/inventory/v1/offer/${offerId}/publish`, {
      method: 'POST',
      headers: jsonHeaders
    });
    let resp = await doPublish();
    let text = await resp.text();

    // eBay rejected every vehicle (e.g. heavy-duty trucks not in its catalog):
    // remove the vehicle list and publish without a compatibility chart
    let removedVehicles = false;
    if (!resp.ok && /compatibilit/i.test(text) && /invalid/i.test(text)) {
      step = 'remove_vehicles';
      if (!offerSku) {
        const g2 = await fetch(`${base}/sell/inventory/v1/offer/${offerId}`, { headers: jsonHeaders });
        if (g2.ok) offerSku = (await g2.json()).sku || null;
      }
      if (offerSku) {
        await fetch(`${base}/sell/inventory/v1/inventory_item/${encodeURIComponent(offerSku)}/product_compatibility`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        removedVehicles = true;
        step = 'publish_retry';
        resp = await doPublish();
        text = await resp.text();
      }
    }
    if (!resp.ok) return reply(resp.status, { step, message: summarize(text) });

    let d = {};
    try { d = JSON.parse(text); } catch (e) {}
    const sandbox = /sandbox/i.test(base);
    const listingUrl = d.listingId ? `https://www.${sandbox ? 'sandbox.' : ''}ebay.com/itm/${d.listingId}` : null;
    return reply(200, {
      message: `Published! eBay listing ${d.listingId || ''} is live${sandbox ? ' on Sandbox' : ''}.` +
        (removedVehicles ? ' It was published WITHOUT a vehicle chart, because eBay didn\u2019t accept any of the vehicles. Keep the fitment in the title or buyer notes.' : ''),
      listingId: d.listingId || null,
      listingUrl,
      sandbox,
      warnings: (d.warnings || []).map(w => w.message).filter(Boolean)
    });
  } catch (err) {
    return reply(500, { step, message: err.message });
  }
};

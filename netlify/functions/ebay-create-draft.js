const { getAccessToken, apiBase } = require('./utils/ebay-auth');

const reply = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

function summarize(text) {
  try {
    const d = JSON.parse(text);
    if (d.errors && d.errors.length) {
      return d.errors.map(e => `${e.errorId || ''} ${e.message || ''}`.trim()).join(' | ');
    }
  } catch (e) {}
  return String(text).slice(0, 300);
}

// Turns "1992-1995" or "1995" into [1992,1993,1994,1995] or [1995].
// eBay's vehicle filter matches on individual years, not ranges.
function expandYears(yearsStr) {
  const parts = String(yearsStr).split(/[\u2013-]/).map(s => s.trim());
  const start = parseInt(parts[0], 10);
  const end = parts.length > 1 ? parseInt(parts[1], 10) : start;
  const years = [];
  for (let y = start; y <= end; y++) years.push(y);
  return years;
}

exports.handler = async (event) => {
  let step = 'start';
  try {
    const { sku, title, description, oem, price, fits } = JSON.parse(event.body || '{}');
    if (!sku || !title) return reply(400, { step, message: 'Missing sku or title.' });

    step = 'token';
    const accessToken = await getAccessToken();
    const base = apiBase();
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Language': 'en-US',
      'Accept-Language': 'en-US'
    };

    step = 'inventory_item';
    const itemResp = await fetch(`${base}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        product: {
          title: title.slice(0, 80),
          description,
          aspects: oem ? { 'OEM Part Number': [oem] } : undefined
        },
        condition: 'NEW',
        availability: { shipToLocationAvailability: { quantity: 1 } }
      })
    });
    if (!itemResp.ok && itemResp.status !== 204) {
      return reply(itemResp.status, { step, message: summarize(await itemResp.text()) });
    }

    // Send the vehicle list in eBay's own format, so a buyer filtering by
    // their vehicle on eBay Motors will actually find this part.
    if (Array.isArray(fits) && fits.length) {
      step = 'compatibility';
      const compatibilityList = [];
      fits.forEach(f => {
        expandYears(f.years).forEach(year => {
          compatibilityList.push({
            compatibilityProperties: [
              { name: 'Make', value: f.make },
              { name: 'Model', value: f.model },
              { name: 'Year', value: String(year) }
            ]
          });
        });
      });

      const compResp = await fetch(`${base}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}/product_compatibility`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ compatibilityList })
      });
      if (!compResp.ok && compResp.status !== 204) {
        return reply(compResp.status, { step, message: summarize(await compResp.text()) });
      }
    }

    step = 'offer';
    const policies = {};
    if (process.env.EBAY_FULFILLMENT_POLICY_ID) policies.fulfillmentPolicyId = process.env.EBAY_FULFILLMENT_POLICY_ID;
    if (process.env.EBAY_PAYMENT_POLICY_ID) policies.paymentPolicyId = process.env.EBAY_PAYMENT_POLICY_ID;
    if (process.env.EBAY_RETURN_POLICY_ID) policies.returnPolicyId = process.env.EBAY_RETURN_POLICY_ID;

    const offer = {
      sku,
      marketplaceId: 'EBAY_US',
      format: 'FIXED_PRICE',
      listingDescription: description,
      availableQuantity: 1,
      categoryId: process.env.EBAY_DEFAULT_CATEGORY_ID || '33564',
      pricingSummary: { price: { value: price || '19.99', currency: 'USD' } },
      merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION_KEY || 'main-warehouse'
    };
    if (Object.keys(policies).length) offer.listingPolicies = policies;

    const offerResp = await fetch(`${base}/sell/inventory/v1/offer`, {
      method: 'POST',
      headers,
      body: JSON.stringify(offer)
    });
    const offerText = await offerResp.text();

    if (!offerResp.ok) {
      let existingId;
      try {
        const d = JSON.parse(offerText);
        const err = (d.errors || []).find(e => e.errorId === 25002);
        const p = err && (err.parameters || []).find(x => x.name === 'offerId');
        existingId = p && p.value;
      } catch (e) {}
      if (existingId) {
        const upd = await fetch(`${base}/sell/inventory/v1/offer/${existingId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(offer)
        });
        if (upd.ok || upd.status === 204) {
          return reply(200, { message: 'Existing draft updated on eBay.', offerId: existingId });
        }
        return reply(upd.status, { step: 'offer_update', message: summarize(await upd.text()) });
      }
      return reply(offerResp.status, { step, message: summarize(offerText) });
    }

    let offerData = {};
    try { offerData = JSON.parse(offerText); } catch (e) {}
    return reply(200, { message: 'Draft created on eBay.', offerId: offerData.offerId });
  } catch (err) {
    return reply(500, { step, message: err.message });
  }
};

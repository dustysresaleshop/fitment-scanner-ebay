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
  const denied = requireAppKey(event);   // app password check
  if (denied) return denied;

  let step = 'start';
  try {
    const { sku, title, description, oem, price, fits, categoryId, brand, aspects: extraAspects, imageUrls, addQty, setQty } = JSON.parse(event.body || '{}');
    const add = Math.min(Math.max(parseInt(addQty, 10) || 1, 1), 999);   // how many pieces are being added now
    if (!sku || !title) return reply(400, { step, message: 'Missing sku or title.' });

    const locationKey = process.env.EBAY_MERCHANT_LOCATION_KEY || 'main-warehouse';

    // Category chosen in the app for this part; falls back to the Netlify default
    const category = /^\d+$/.test(String(categoryId || ''))
      ? String(categoryId)
      : (process.env.EBAY_DEFAULT_CATEGORY_ID || '33564');

    step = 'token';
    const accessToken = await getAccessToken();
    const base = apiBase();
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Language': 'en-US',
      'Accept-Language': 'en-US'
    };

    // Check how many of this part are already listed, so a repeat scan adds
    // to the count instead of resetting it back to 1 each time.
    step = 'check_quantity';
    let quantity = add;
    let existingImages = [];
    const existingItemResp = await fetch(`${base}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, 'Accept-Language': 'en-US' }
    });
    if (existingItemResp.ok) {
      const existingItem = await existingItemResp.json();
      const currentQty = existingItem.availability && existingItem.availability.shipToLocationAvailability
        ? existingItem.availability.shipToLocationAvailability.quantity
        : 0;
      quantity = setQty ? add : (currentQty || 0) + add;   // setQty: make this the total instead of adding
      existingImages = (existingItem.product && existingItem.product.imageUrls) || [];
    }
    // A 404 here just means this part has never been scanned before, so it
    // starts at quantity 1, which is already the default above.

    // Item specifics most parts categories require
    const aspects = { Brand: [String(brand || 'Ford').slice(0, 65)] };
    if (oem) {
      aspects['Manufacturer Part Number'] = [oem];
      aspects['OEM Part Number'] = [oem];
    }
    // Details the category requires (like Type), filled in on the app's screen
    if (extraAspects && typeof extraAspects === 'object') {
      Object.entries(extraAspects).slice(0, 40).forEach(([name, val]) => {
        const key = String(name).trim().slice(0, 65);
        const vals = (Array.isArray(val) ? val : [val])
          .map(v => String(v).trim().slice(0, 65)).filter(Boolean).slice(0, 30);
        if (key && vals.length && !aspects[key]) aspects[key] = vals;
      });
    }

    // Photos: new ones from the webcam, or keep the listing's existing photos
    const newImages = (Array.isArray(imageUrls) ? imageUrls : [])
      .map(u => String(u)).filter(u => /^https:\/\//.test(u)).slice(0, 24);
    const images = newImages.length ? newImages : existingImages;

    step = 'inventory_item';
    const itemResp = await fetch(`${base}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        product: {
          title: title.slice(0, 80),
          description,
          aspects,
          imageUrls: images.length ? images : undefined
        },
        condition: 'NEW',
        // Tie the quantity to the storage location, which eBay's inventory service requires
        availability: {
          shipToLocationAvailability: {
            quantity,
            availabilityDistributions: [{ merchantLocationKey: locationKey, quantity }]
          }
        }
      })
    });
    if (!itemResp.ok && itemResp.status !== 204) {
      return reply(itemResp.status, { step, message: summarize(await itemResp.text()) });
    }

    // Send the vehicle list in eBay's own format, so a buyer filtering by
    // their vehicle on eBay Motors will actually find this part.
    // eBay's field is "compatibleProducts", and its property names are
    // lowercase ("make"/"model"/"year") -- confirmed via a live test call.
    if (!Array.isArray(fits) || !fits.length) {
      // No vehicles: remove any vehicle list left on eBay from an earlier push
      step = 'clear_compatibility';
      await fetch(`${base}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}/product_compatibility`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      });   // a 404 just means there was nothing to remove
    } else {
      step = 'compatibility';
      const compatibleProducts = [];
      fits.forEach(f => {
        expandYears(f.years).forEach(year => {
          compatibleProducts.push({
            compatibilityProperties: [
              { name: 'make', value: f.make },
              { name: 'model', value: f.model },
              { name: 'year', value: String(year) }
            ]
          });
        });
      });

      const compResp = await fetch(`${base}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}/product_compatibility`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ sku, compatibleProducts })
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
      // Car parts use eBay Motors categories, which only exist on the eBay Motors
      // marketplace. (In this API its code is EBAY_MOTORS.)
      marketplaceId: process.env.EBAY_MARKETPLACE_ID || 'EBAY_MOTORS',
      format: 'FIXED_PRICE',
      listingDescription: description,
      availableQuantity: quantity,
      categoryId: category,
      pricingSummary: { price: { value: price || '19.99', currency: 'USD' } },
      merchantLocationKey: locationKey
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
          // Is this listing already live, or still a draft that needs publishing?
          let published = false;
          try {
            const g = await fetch(`${base}/sell/inventory/v1/offer/${existingId}`, { headers });
            if (g.ok) published = (await g.json()).status === 'PUBLISHED';
          } catch (e) {}
          return reply(200, {
            message: published
              ? `Existing listing updated on eBay. Quantity is now ${quantity}.`
              : `Existing draft updated on eBay (not live yet). Quantity is now ${quantity}.`,
            offerId: existingId,
            published
          });
        }
        return reply(upd.status, { step: 'offer_update', message: summarize(await upd.text()) });
      }
      return reply(offerResp.status, { step, message: summarize(offerText) });
    }

    let offerData = {};
    try { offerData = JSON.parse(offerText); } catch (e) {}
    return reply(200, { message: `Draft created on eBay. Quantity is ${quantity}.`, offerId: offerData.offerId, published: false });
  } catch (err) {
    return reply(500, { step, message: err.message });
  }
};

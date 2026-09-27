const { getAccessToken, apiBase } = require('./utils/ebay-auth');

exports.handler = async (event) => {
  try {
    const { sku, title, description, oem, price } = JSON.parse(event.body || '{}');
    if (!sku || !title) {
      return { statusCode: 400, body: 'Missing sku or title.' };
    }

    const accessToken = await getAccessToken();
    const base = apiBase();
    const locationKey = process.env.EBAY_MERCHANT_LOCATION_KEY || 'main-warehouse';

    const itemResp = await fetch(`${base}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Language': 'en-US'
      },
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
      const t = await itemResp.text();
      return { statusCode: itemResp.status, body: `Inventory item failed: ${t}` };
    }

    const offerResp = await fetch(`${base}/sell/inventory/v1/offer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Language': 'en-US'
      },
      body: JSON.stringify({
        sku,
        marketplaceId: 'EBAY_US',
        format: 'FIXED_PRICE',
        listingDescription: description,
        availableQuantity: 1,
        categoryId: process.env.EBAY_DEFAULT_CATEGORY_ID || '33564',
        pricingSummary: { price: { value: price || '19.99', currency: 'USD' } },
        merchantLocationKey: locationKey
      })
    });

    const offerData = await offerResp.json();
    if (!offerResp.ok) {
      return { statusCode: offerResp.status, body: JSON.stringify(offerData) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Draft created on eBay.', offerId: offerData.offerId })
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};

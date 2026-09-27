// Run this once (visit the URL in a browser) before creating your first draft.
// eBay requires a registered inventory location before it will accept offers.

const { getAccessToken, apiBase } = require('./utils/ebay-auth');

exports.handler = async () => {
  try {
    const accessToken = await getAccessToken();
    const locationKey = process.env.EBAY_MERCHANT_LOCATION_KEY || 'main-warehouse';

    const resp = await fetch(`${apiBase()}/sell/inventory/v1/location/${locationKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        location: {
          address: {
            country: process.env.EBAY_LOCATION_COUNTRY || 'US',
            postalCode: process.env.EBAY_LOCATION_POSTAL_CODE || '90001'
          }
        },
        locationTypes: ['WAREHOUSE'],
        merchantLocationStatus: 'ENABLED'
      })
    });

    if (resp.status === 204 || resp.ok) {
      return {
        statusCode: 200,
        body: `Location "${locationKey}" created (or already existed). Save EBAY_MERCHANT_LOCATION_KEY=${locationKey} as an env var if you haven't already.`
      };
    }
    const text = await resp.text();
    return { statusCode: resp.status, body: text };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};

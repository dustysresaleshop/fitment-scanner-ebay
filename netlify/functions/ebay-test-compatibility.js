// Temporary diagnostic only. Visit this URL directly in a browser to test
// eBay's compatibility endpoint with one simple, hardcoded entry, so we can
// see the full raw response instead of a summarized error message.

const { getAccessToken, apiBase } = require('./utils/ebay-auth');

exports.handler = async () => {
  try {
    const accessToken = await getAccessToken();
    const base = apiBase();
    const sku = '10137665';

    const body = {
      sku,
      compatibleProducts: [
        {
          compatibilityProperties: [
            { name: 'make', value: 'Chevrolet' },
            { name: 'model', value: 'Blazer' },
            { name: 'year', value: '1993' }
          ]
        }
      ]
    };

    const resp = await fetch(`${base}/sell/inventory/v1/inventory_item/${sku}/product_compatibility`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Language': 'en-US',
        'Accept-Language': 'en-US'
      },
      body: JSON.stringify(body)
    });

    const text = await resp.text();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sentStatus: resp.status,
        sentBody: body,
        ebayResponse: text
      }, null, 2)
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};

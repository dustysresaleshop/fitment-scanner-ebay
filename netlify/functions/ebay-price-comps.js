const { getAppAccessToken } = require('./utils/ebay-auth');

exports.handler = async (event) => {
  try {
    const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
    if (!q) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Missing q parameter.' }) };
    }

    const token = await getAppAccessToken();
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=25`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        Accept: 'application/json'
      }
    });
    const text = await resp.text();

    if (!resp.ok) {
      return { statusCode: resp.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text.slice(0, 500), requestUrl: url }) };
    }

    const data = JSON.parse(text);
    const items = (data.itemSummaries || []).filter(i => i.price && i.price.value);

    if (!items.length) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 0 }) };
    }

    const prices = items.map(i => parseFloat(i.price.value)).sort((a, b) => a - b);
    const low = prices[0];
    const high = prices[prices.length - 1];
    const median = prices[Math.floor(prices.length / 2)];

    const listings = items.slice(0, 10).map(i => ({
      title: i.title,
      price: parseFloat(i.price.value),
      condition: i.condition,
      url: i.itemWebUrl
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: items.length, low, median, high, suggested: median, listings })
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: err.message }) };
  }
};

// netlify/functions/ebay-publish-offer.js
// Takes an eBay draft (offer) live. Body: { "offerId": "1234567890" }
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
      return d.errors.map(e => {
        const params = (e.parameters || []).map(p => `${p.name}=${p.value}`).join(', ');
        return `${e.errorId || ''} ${e.message || ''}${params ? ' [' + params + ']' : ''}`.trim();
      }).join(' | ');
    }
  } catch (e) {}
  return String(text).slice(0, 300);
}

exports.handler = async (event) => {
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

    step = 'publish';
    const resp = await fetch(`${base}/sell/inventory/v1/offer/${offerId}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Language': 'en-US',
        'Accept-Language': 'en-US'
      }
    });
    const text = await resp.text();
    if (!resp.ok) return reply(resp.status, { step, message: summarize(text) });

    let d = {};
    try { d = JSON.parse(text); } catch (e) {}
    const sandbox = /sandbox/i.test(base);
    const listingUrl = d.listingId ? `https://www.${sandbox ? 'sandbox.' : ''}ebay.com/itm/${d.listingId}` : null;
    return reply(200, {
      message: `Published! eBay listing ${d.listingId || ''} is live${sandbox ? ' on Sandbox' : ''}.`,
      listingId: d.listingId || null,
      listingUrl,
      sandbox,
      warnings: (d.warnings || []).map(w => w.message).filter(Boolean)
    });
  } catch (err) {
    return reply(500, { step, message: err.message });
  }
};

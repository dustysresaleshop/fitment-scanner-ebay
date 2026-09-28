// Shared helpers for talking to eBay.
// getAccessToken() = a user token, using the refresh token (used for creating drafts).
// getAppAccessToken() = an app-only token, using the Production keys (used for public price search).

function tokenUrl() {
  const env = process.env.EBAY_ENV || 'sandbox';
  return env === 'production'
    ? 'https://api.ebay.com/identity/v1/oauth2/token'
    : 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';
}

function apiBase() {
  const env = process.env.EBAY_ENV || 'sandbox';
  return env === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
}

async function getAccessToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const refreshToken = process.env.EBAY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, or EBAY_REFRESH_TOKEN environment variable.'
    );
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'https://api.ebay.com/oauth/api_scope/sell.inventory'
  });

  const resp = await fetch(tokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`
    },
    body: body.toString()
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// Price search always uses real eBay listings, so this always talks to
// production, using your EBAY_PROD_CLIENT_ID / EBAY_PROD_CLIENT_SECRET,
// regardless of what EBAY_ENV is set to for the draft-creation side.
async function getAppAccessToken() {
  const clientId = process.env.EBAY_PROD_CLIENT_ID;
  const clientSecret = process.env.EBAY_PROD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing EBAY_PROD_CLIENT_ID or EBAY_PROD_CLIENT_SECRET environment variable.');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope'
  });

  const resp = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`
    },
    body: body.toString()
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`App token failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

module.exports = { getAccessToken, apiBase, tokenUrl, getAppAccessToken };

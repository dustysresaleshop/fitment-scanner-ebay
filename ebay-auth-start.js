// Visit /.netlify/functions/ebay-auth-start once to kick off authorization.
// It sends your browser to eBay's consent screen.

exports.handler = async () => {
  const clientId = process.env.EBAY_CLIENT_ID;
  const redirectUri = process.env.EBAY_REDIRECT_URI; // this is the RuName from your eBay keyset
  const env = process.env.EBAY_ENV || 'sandbox';

  if (!clientId || !redirectUri) {
    return {
      statusCode: 500,
      body: 'Missing EBAY_CLIENT_ID or EBAY_REDIRECT_URI environment variable.'
    };
  }

  const authBase =
    env === 'production'
      ? 'https://auth.ebay.com/oauth2/authorize'
      : 'https://auth.sandbox.ebay.com/oauth2/authorize';

  const scope = encodeURIComponent('https://api.ebay.com/oauth/api_scope/sell.inventory');
  const url = `${authBase}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}`;

  return {
    statusCode: 302,
    headers: { Location: url }
  };
};

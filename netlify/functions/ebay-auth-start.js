// eBay redirects here after you approve access. Exchanges the one-time code
// for an access token + refresh token, and shows the refresh token once so
// you can save it as the EBAY_REFRESH_TOKEN environment variable.

const { tokenUrl } = require('./utils/ebay-auth');

exports.handler = async (event) => {
  const code = event.queryStringParameters && event.queryStringParameters.code;
  if (!code) {
    return { statusCode: 400, body: 'Missing authorization code from eBay.' };
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const redirectUri = process.env.EBAY_REDIRECT_URI;

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
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
    return { statusCode: 500, body: `Token exchange failed: ${JSON.stringify(data)}` };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<html><body style="font-family:sans-serif;padding:24px;max-width:600px;margin:auto;">
      <h2>Authorization successful</h2>
      <p>Copy the refresh token below and save it as the <code>EBAY_REFRESH_TOKEN</code>
      environment variable in Netlify (Site settings → Environment variables), then redeploy.</p>
      <textarea style="width:100%;height:120px;">${data.refresh_token}</textarea>
      <p style="color:#666;font-size:13px;">You only need to do this once — this token stays
      valid for authorizing future draft-listing calls without you clicking through eBay again.</p>
    </body></html>`
  };
};

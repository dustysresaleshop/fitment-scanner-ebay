// netlify/functions/ebay-connect.js
// One-time tool to get a new eBay refresh token with the permissions the app needs.
// 1. Visit /.netlify/functions/ebay-connect  -> sends you to eBay to sign in
// 2. eBay sends you back here with a code     -> this trades it for a refresh token
// Needs Netlify variables: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RUNAME (and EBAY_ENV)
const { tokenUrl } = require('./utils/ebay-auth');

const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment'
].join(' ');

const page = (title, bodyHtml) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; background:#14171a; color:#eef0ef; max-width:640px; margin:0 auto; padding:24px 16px; line-height:1.5; }
  h1 { font-size:20px; } code, textarea { font-family: ui-monospace, monospace; }
  textarea { width:100%; min-height:140px; background:#23282c; color:#eef0ef; border:1px solid #33393e; border-radius:8px; padding:10px; box-sizing:border-box; }
  button { background:#f4c430; color:#1a1a1a; border:0; border-radius:8px; padding:10px 16px; font-weight:600; font-size:15px; cursor:pointer; margin-top:10px; }
  .err { color:#d9694f; } ol li { margin-bottom:6px; }
</style></head><body>${bodyHtml}</body></html>`
});

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

exports.handler = async (event) => {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const ruName = process.env.EBAY_RUNAME;
  const production = (process.env.EBAY_ENV || 'sandbox') === 'production';

  if (!clientId || !clientSecret || !ruName) {
    return page('Setup needed', `<h1 class="err">Missing a Netlify variable</h1>
      <p>Make sure <code>EBAY_CLIENT_ID</code>, <code>EBAY_CLIENT_SECRET</code>, and <code>EBAY_RUNAME</code> are set, then redeploy.</p>`);
  }

  const q = event.queryStringParameters || {};

  if (q.error) {
    return page('Not connected', `<h1 class="err">eBay didn't connect</h1><p>${esc(q.error_description || q.error)}</p>`);
  }

  // Step 1: no code yet, so send the user to eBay's sign-in page
  if (!q.code) {
    const authBase = production ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com';
    const url = `${authBase}/oauth2/authorize?` + new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: ruName,
      scope: SCOPES
    }).toString();
    return { statusCode: 302, headers: { Location: url, 'Cache-Control': 'no-store' }, body: '' };
  }

  // Step 2: eBay sent us back a code; trade it for tokens
  const resp = await fetch(tokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: q.code, redirect_uri: ruName }).toString()
  });
  const data = await resp.json().catch(() => ({}));

  if (!resp.ok || !data.refresh_token) {
    return page('Not connected', `<h1 class="err">Couldn't get a refresh token</h1><pre>${esc(JSON.stringify(data, null, 2))}</pre>`);
  }

  const days = Math.round((data.refresh_token_expires_in || 0) / 86400);
  return page('eBay connected', `<h1>Connected to eBay ${production ? '' : '(Sandbox)'}</h1>
    <p>Here's your new refresh token${days ? ` (good for about ${days} days)` : ''}:</p>
    <textarea id="t" readonly>${esc(data.refresh_token)}</textarea>
    <button onclick="navigator.clipboard.writeText(document.getElementById('t').value).then(()=>this.textContent='Copied')">Copy token</button>
    <ol>
      <li>In Netlify, open Project configuration, then Environment variables.</li>
      <li>Edit <code>EBAY_REFRESH_TOKEN</code>, paste this token, and save.</li>
      <li>Go to Deploys, then Trigger deploy, then Deploy site.</li>
    </ol>
    <p>Keep this token private. Close this page when you're done.</p>`);
};

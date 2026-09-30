// netlify/functions/ebay-category.js
// Suggests eBay categories for a part name. Use: /.netlify/functions/ebay-category?q=intake%20valve
const { tokenUrl, apiBase } = require('./utils/ebay-auth');

const reply = (statusCode, obj, cache) => ({
  statusCode,
  headers: Object.assign({ 'Content-Type': 'application/json' },
    cache ? { 'Netlify-CDN-Cache-Control': 'public, s-maxage=604800' } : {}),
  body: JSON.stringify(obj)
});

let cached = null;
async function appToken() {
  if (cached && cached.expires > Date.now()) return cached.token;
  const resp = await fetch(tokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }).toString()
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`App token failed: ${data.error_description || data.error || resp.status}`);
  cached = { token: data.access_token, expires: Date.now() + ((data.expires_in || 7200) - 300) * 1000 };
  return cached.token;
}

exports.handler = async (event) => {
  const q = String((event.queryStringParameters || {}).q || '').trim().slice(0, 100);
  if (!q) return reply(400, { error: 'Add ?q= with a part name' });
  try {
    const token = await appToken();
    const resp = await fetch(`${apiBase()}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'en-US' }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (data.errors || []).map(e => `${e.errorId} ${e.message}`).join(' | ') || resp.status;
      return reply(resp.status, { error: 'Category search failed: ' + msg });
    }
    const suggestions = (data.categorySuggestions || []).map(s => {
      const ancestors = (s.categoryTreeNodeAncestors || []).slice().reverse().map(a => a.categoryName);
      return {
        id: s.category.categoryId,
        name: s.category.categoryName,
        path: [...ancestors, s.category.categoryName].join(' > ')
      };
    });
    // Car parts belong under eBay Motors, so list those first
    suggestions.sort((a, b) => (b.path.startsWith('eBay Motors') ? 1 : 0) - (a.path.startsWith('eBay Motors') ? 1 : 0));
    return reply(200, { query: q, suggestions: suggestions.slice(0, 8) }, true);
  } catch (e) {
    return reply(500, { error: e.message });
  }
};

// netlify/functions/ebay-category.js
// Suggests eBay Motors categories for a part name. Use: /.netlify/functions/ebay-category?q=intake%20valve
// Always reads eBay's real (Production) category list, because Sandbox is missing
// most car-part categories. This is read-only and doesn't touch your listings.
const { getAppAccessToken, tokenUrl, apiBase } = require('./utils/ebay-auth');
const { requireAppKey } = require('./utils/app-auth');
const TAXONOMY_BASE = 'https://api.ebay.com';
// eBay Motors (car parts) has its own category list, separate from the main eBay list
const MOTORS_TREE = '100';

const reply = (statusCode, obj, cache) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj)
});

let cached = null;
async function appToken() {
  if (cached && cached.expires > Date.now()) return cached.token;
  const token = await getAppAccessToken();
  cached = { token, expires: Date.now() + 90 * 60 * 1000 };
  return token;
}

async function suggest(token, q) {
  const resp = await fetch(`${TAXONOMY_BASE}/commerce/taxonomy/v1/category_tree/${MOTORS_TREE}/get_category_suggestions?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'en-US' }
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data.errors || []).map(e => `${e.errorId} ${e.message}`).join(' | ') || resp.status;
    throw new Error('Category search failed: ' + msg);
  }
  return (data.categorySuggestions || []).map(s => {
    const ancestors = (s.categoryTreeNodeAncestors || []).slice().reverse().map(a => a.categoryName);
    const parts = [...ancestors, s.category.categoryName];
    if (!/^eBay Motors/i.test(parts[0] || '')) parts.unshift('eBay Motors');
    return {
      id: s.category.categoryId,
      name: s.category.categoryName,
      path: parts.join(' > ')
    };
  });
}

const isMotors = c => /^eBay Motors/i.test(c.path) && /Parts & Accessories/i.test(c.path);

// Required item details ("aspects") for a category, e.g. Type
async function requiredAspects(token, categoryId) {
  const resp = await fetch(`${TAXONOMY_BASE}/commerce/taxonomy/v1/category_tree/${MOTORS_TREE}/get_item_aspects_for_category?category_id=${categoryId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'en-US' }
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data.errors || []).map(e => `${e.errorId} ${e.message}`).join(' | ') || resp.status;
    throw new Error('Could not load required details: ' + msg);
  }
  return (data.aspects || [])
    .filter(a => a.aspectConstraint && a.aspectConstraint.aspectRequired)
    .map(a => ({
      name: a.localizedAspectName,
      mode: a.aspectConstraint.aspectMode,
      multi: a.aspectConstraint.itemToAspectCardinality === 'MULTI',
      values: (a.aspectValues || []).map(v => v.localizedValue).slice(0, 300)
    }));
}

// Diagnostic: does the environment your listings use (Sandbox or Production) know this category?
async function envCategoryCheck(categoryId) {
  const tokResp = await fetch(tokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }).toString()
  });
  const tok = await tokResp.json().catch(() => ({}));
  if (!tokResp.ok) return { error: 'Token failed: ' + (tok.error_description || tok.error || tokResp.status) };
  const out = { environment: /sandbox/i.test(apiBase()) ? 'sandbox' : 'production', categoryId };
  for (const tree of ['0', '100']) {
    const r = await fetch(`${apiBase()}/commerce/taxonomy/v1/category_tree/${tree}/get_category_subtree?category_id=${categoryId}`, {
      headers: { Authorization: `Bearer ${tok.access_token}`, 'Accept-Language': 'en-US' }
    });
    const d = await r.json().catch(() => ({}));
    out[tree === '0' ? 'mainEbayList' : 'ebayMotorsList'] = r.ok
      ? 'FOUND: ' + ((d.categorySubtreeNode && d.categorySubtreeNode.category && d.categorySubtreeNode.category.categoryName) || '')
      : 'NOT FOUND (' + ((d.errors || []).map(e => `${e.errorId} ${e.message}`).join(' | ') || r.status) + ')';
  }
  return out;
}

exports.handler = async (event) => {
  const denied = requireAppKey(event);   // app password check
  if (denied) return denied;

  const qs = event.queryStringParameters || {};
  if (qs.check) {
    if (!/^\d+$/.test(qs.check)) return reply(400, { error: 'Bad category ID' });
    try { return reply(200, await envCategoryCheck(qs.check)); } catch (e) { return reply(500, { error: e.message }); }
  }
  if (qs.aspects) {
    if (!/^\d+$/.test(qs.aspects)) return reply(400, { error: 'Bad category ID' });
    try {
      const token = await appToken();
      return reply(200, { categoryId: qs.aspects, aspects: await requiredAspects(token, qs.aspects) }, true);
    } catch (e) {
      return reply(500, { error: e.message });
    }
  }

  const q = String(qs.q || '').trim().slice(0, 100);
  if (!q) return reply(400, { error: 'Add ?q= with a part name' });
  try {
    const token = await appToken();

    // "Ford" steers eBay toward car parts instead of plumbing, home, etc.
    const steered = /\bford\b/i.test(q) ? q : `Ford ${q}`;
    let all = await suggest(token, steered);
    let motors = all.filter(isMotors);

    if (!motors.length && steered !== q) {
      const plain = await suggest(token, q);
      all = all.concat(plain);
      motors = plain.filter(isMotors);
    }

    if (motors.length) {
      return reply(200, { query: q, motorsOnly: true, suggestions: motors.slice(0, 8) }, true);
    }
    // Nothing car-related: return no picks, so the app asks for a better search
    // instead of quietly choosing a non-car category
    return reply(200, {
      query: q,
      motorsOnly: false,
      warning: 'No eBay Motors categories matched. Try a different search, like "engine valve" or "piston rings".',
      suggestions: [],
      otherCategories: all.slice(0, 5)
    });
  } catch (e) {
    return reply(500, { error: e.message });
  }
};

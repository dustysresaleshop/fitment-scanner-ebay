// netlify/functions/fpg-lookup.js
// Looks up a Ford part number on FordPartsGiant and returns its fitment.
// Use: /.netlify/functions/fpg-lookup?pn=E9SZ-6507-B

const UA = 'Mozilla/5.0 (compatible; DustysResaleShop-FitmentLookup/1.0)';

function decode(s) {
  return String(s || '')
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const compact = pn => pn.replace(/[^A-Z0-9]/g, '');

async function fetchPart(pn) {
  const url = `https://www.fordpartsgiant.com/parts/ford-x_${compact(pn).toLowerCase()}.html`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow' });
  if (!resp.ok) return null;
  const html = await resp.text();

  // The page must have product data for a real part
  let product = null;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      if (j['@type'] === 'Product') { product = j; break; }
    } catch (e) {}
  }
  if (!product || !product.mpn) return null;

  const descRow = html.match(/<td>Part Description<\/td>\s*<td>([\s\S]*?)<\/td>/i);
  const description = descRow ? decode(descRow[1]) : '';

  // Fitment table: Year Make Model | Engine | Option details
  const rows = [];
  const table = html.match(/<table[^>]*fit-vehicle-list-table[^>]*>([\s\S]*?)<\/table>/i);
  if (table) {
    const body = (table[1].match(/<tbody>([\s\S]*?)<\/tbody>/i) || [])[1] || '';
    for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(td => {
        const t = td[1].match(/title="([^"]*)"/);
        return decode(t ? t[1] : td[1]);
      });
      const ymm = (cells[0] || '').match(/^(\d{4})\s+(\S+)\s+(.+)$/);
      if (!ymm) continue;
      rows.push({
        year: Number(ymm[1]),
        make: ymm[2],
        model: ymm[3],
        engines: (cells[1] || '').split(',').map(e => e.trim()).filter(Boolean),
        options: cells[2] || ''
      });
    }
  }

  // Replacement / supersession notice, if the page shows one
  const text = decode(html);
  const rep = text.match(/(?:Replaced by|Superseded by|Replacement part)[^A-Z0-9]{0,40}([A-Z0-9]{4}-?[A-Z0-9]{4,7}-?[A-Z]{1,3})/i);

  return {
    mpn: product.mpn,
    name: description.split(';')[0].trim() || decode(product.name),
    description,
    discontinued: /Discontinued/i.test(JSON.stringify(product.offers || {})),
    replacedBy: rep ? rep[1].toUpperCase() : null,
    sourceUrl: product.url || url,
    rows
  };
}

exports.handler = async (event) => {
  const pn = String((event.queryStringParameters || {}).pn || '').toUpperCase().trim();
  if (!/^[A-Z0-9-]{5,24}$/.test(pn)) {
    return { statusCode: 400, body: JSON.stringify({ found: false, error: 'Bad part number' }) };
  }

  const json = (obj, cache) => ({
    statusCode: 200,
    headers: Object.assign({ 'Content-Type': 'application/json' },
      cache ? { 'Netlify-CDN-Cache-Control': 'public, s-maxage=604800' } : {}),
    body: JSON.stringify(obj)
  });

  try {
    let part = await fetchPart(pn);
    let fallbackFrom = null;

    // Not listed? Try the standard -A version (oversize/variant parts often aren't listed)
    const bits = pn.split('-');
    if (!part && bits.length === 3 && bits[2] !== 'A') {
      const basePn = `${bits[0]}-${bits[1]}-A`;
      part = await fetchPart(basePn);
      if (part) fallbackFrom = basePn;
    }

    if (!part) return json({ found: false, requested: pn }, true);

    // Did the site send us to a different number (possible supersession)?
    const expected = compact(fallbackFrom || pn);
    const redirectedTo = compact(part.mpn) !== expected ? part.mpn : null;

    return json({ found: true, requested: pn, fallbackFrom, redirectedTo, ...part }, true);
  } catch (e) {
    return json({ found: false, requested: pn, error: 'Lookup failed: ' + e.message }, false);
  }
};

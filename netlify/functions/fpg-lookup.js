// netlify/functions/fpg-lookup.js
// Looks up a Ford part number on FordPartsGiant and returns its fitment.
// Use: /.netlify/functions/fpg-lookup?pn=E9SZ-6507-B

const { requireAppKey } = require('./utils/app-auth');

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
  const noteRow = html.match(/<td>Manufacturer Note<\/td>\s*<td>([\s\S]*?)<\/td>/i);
  const note = noteRow ? decode(noteRow[1]).replace(/\s+,/g, ',') : '';

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
      // "1995 Ford Thunderbird" or a range like "2000-2006 Mercury Grand Marquis"
      const ymm = (cells[0] || '').match(/^(\d{4})(?:\s*[-\u2013]\s*(\d{4}))?\s+(\S+)\s+(.+)$/);
      if (!ymm) continue;
      const first = Number(ymm[1]);
      const last = ymm[2] ? Number(ymm[2]) : first;
      const engines = (cells[1] || '').split(',').map(e => e.trim()).filter(Boolean);
      for (let y = first; y <= last && y <= first + 60; y++) {
        rows.push({ year: y, make: ymm[3], model: ymm[4], engines, options: cells[2] || '' });
      }
    }
  }

  // Replacement / supersession notice, if the page shows one
  const text = decode(html);
  const rep = text.match(/(?:Replaced by|Superseded by|Replacement part)[^A-Z0-9]{0,40}([A-Z0-9]{4}-?[A-Z0-9]{4,7}-?[A-Z]{1,3})/i);

  return {
    mpn: product.mpn,
    name: description.split(';')[0].trim() || decode(product.name),
    description,
    note,
    discontinued: /Discontinued/i.test(JSON.stringify(product.offers || {})),
    replacedBy: rep ? rep[1].toUpperCase() : null,
    sourceUrl: product.url || url,
    rows
  };
}

// Nearby suffixes for color/side/revision variants, closest first.
// "AAE" -> AAD, AAF, AAC, AAG, AAB, ...   "C" -> B, D, A, E, ...
function siblingSuffixes(suffix) {
  if (!/^[A-Z]{1,3}$/.test(suffix)) return [];
  const head = suffix.slice(0, -1);
  const last = suffix.charCodeAt(suffix.length - 1);
  const out = [];
  for (let c = 65; c <= Math.max(72, last + 2); c++) {
    if (c !== last) out.push({ s: head + String.fromCharCode(c), d: Math.abs(c - last) + (c > last ? 0.1 : 0) });
  }
  return out.sort((a, b) => a.d - b.d).map(x => x.s);
}

exports.handler = async (event) => {
  const denied = requireAppKey(event);   // app password check
  if (denied) return denied;
  if ((event.queryStringParameters || {}).ping) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  }

  const pn = String((event.queryStringParameters || {}).pn || '').toUpperCase().trim();
  if (!/^[A-Z0-9-]{5,24}$/.test(pn)) {
    return { statusCode: 400, body: JSON.stringify({ found: false, error: 'Bad part number' }) };
  }

  const json = (obj, cache) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj)
  });

  try {
    let part = await fetchPart(pn);
    let fallbackFrom = null;

    // Not listed? Try sibling numbers (other colors, sides, or oversize versions), all at once
    const bits = pn.split('-');
    if (!part && bits.length === 3) {
      const tries = siblingSuffixes(bits[2]).slice(0, 8).map(s => `${bits[0]}-${bits[1]}-${s}`);
      const results = await Promise.all(tries.map(t => fetchPart(t).catch(() => null)));
      const i = results.findIndex(Boolean);
      if (i >= 0) { part = results[i]; fallbackFrom = tries[i]; }
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

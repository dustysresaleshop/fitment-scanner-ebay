// netlify/functions/fpg-probe.js
// Temporary test tool: fetches one FordPartsGiant page and returns the pieces
// needed to build the automatic fitment lookup. Delete once the real lookup works.
//
// Use: /.netlify/functions/fpg-probe?url=<paste a fordpartsgiant.com link>

exports.handler = async (event) => {
  const raw = event.rawQuery || '';
  let url = raw.replace(/^url=/, '');
  try { url = decodeURIComponent(url); } catch (e) {}

  if (!/^https:\/\/www\.fordpartsgiant\.com\//.test(url)) {
    return { statusCode: 400, body: 'Add ?url= followed by a fordpartsgiant.com link' };
  }

  let resp, html;
  try {
    resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DustysResaleShop-FitmentLookup/1.0)',
        'Accept': 'text/html'
      },
      redirect: 'follow'
    });
    html = await resp.text();
  } catch (e) {
    return { statusCode: 502, body: 'Could not reach the site: ' + e.message };
  }

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';

  // Structured product data, if the page has any
  const jsonLd = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .slice(0, 3).map(m => m[1].trim().slice(0, 3000));

  // Links to part pages (shows how search results are laid out)
  const partLinks = [...new Set([...html.matchAll(/href="([^"]*\/parts\/[^"]+\.html)"/gi)].map(m => m[1]))].slice(0, 20);

  // Raw HTML around the words that usually mark fitment info
  const windows = {};
  for (const word of ['itment', 'Fits', 'Replaced', 'Fit Note', 'Applications']) {
    const hits = [];
    let i = html.indexOf(word);
    while (i !== -1 && hits.length < 2) {
      hits.push(html.slice(Math.max(0, i - 600), i + 1200).replace(/\s+/g, ' '));
      i = html.indexOf(word, i + 1200);
    }
    if (hits.length) windows[word] = hits;
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requested: url,
      status: resp.status,
      finalUrl: resp.url,
      title: title.trim(),
      htmlLength: html.length,
      jsonLd,
      partLinks,
      windows
    }, null, 2)
  };
};

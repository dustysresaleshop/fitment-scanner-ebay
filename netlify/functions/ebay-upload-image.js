// netlify/functions/ebay-upload-image.js
// Uploads one listing photo to eBay Picture Services and returns its eBay image URL.
// Body: { "image": "data:image/jpeg;base64,..." }
const { getAccessToken, apiBase } = require('./utils/ebay-auth');
const { requireAppKey } = require('./utils/app-auth');

const reply = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

function summarize(text) {
  try {
    const d = JSON.parse(text);
    if (d.errors && d.errors.length) return d.errors.map(e => `${e.errorId || ''} ${e.message || ''}`.trim()).join(' | ');
  } catch (e) {}
  return String(text).slice(0, 300);
}

exports.handler = async (event) => {
  const denied = requireAppKey(event);   // app password check
  if (denied) return denied;

  if (event.httpMethod !== 'POST') return reply(405, { message: 'Use POST.' });
  let step = 'start';
  try {
    const { image } = JSON.parse(event.body || '{}');
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
    if (!m) return reply(400, { message: 'Send a JPEG, PNG, or WebP image.' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length < 1000) return reply(400, { message: 'That image looks empty.' });

    step = 'token';
    const token = await getAccessToken();
    const mediaBase = /sandbox/i.test(apiBase()) ? 'https://apim.sandbox.ebay.com' : 'https://apim.ebay.com';

    step = 'upload';
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const form = new FormData();
    form.append('image', new Blob([buf], { type: `image/${m[1]}` }), `photo.${ext}`);
    const resp = await fetch(`${mediaBase}/commerce/media/v1_beta/image/create_image_from_file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    const text = await resp.text();
    if (!resp.ok) return reply(resp.status, { step, message: summarize(text) });

    let data = {};
    try { data = JSON.parse(text); } catch (e) {}
    let imageUrl = data.imageUrl;

    // Some responses only give the image's address in the Location header
    if (!imageUrl) {
      step = 'get_image';
      const loc = resp.headers.get('location');
      if (loc) {
        const g = await fetch(loc, { headers: { Authorization: `Bearer ${token}` } });
        const gd = await g.json().catch(() => ({}));
        imageUrl = gd.imageUrl;
      }
    }
    if (!imageUrl) return reply(502, { step, message: 'eBay did not return an image link.' });
    return reply(200, { imageUrl, expirationDate: data.expirationDate || null });
  } catch (err) {
    return reply(500, { step, message: err.message });
  }
};

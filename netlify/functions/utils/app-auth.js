// netlify/functions/utils/app-auth.js
// Every function calls requireAppKey(event) first. Only requests carrying the
// app password (set as APP_PASSWORD in Netlify) are allowed through.
const crypto = require('crypto');

const sha = s => crypto.createHash('sha256').update(String(s)).digest();

function deny(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ locked: true, message })
  };
}

// Returns null when the password is right, or a ready-to-send "not allowed" response
function requireAppKey(event) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    // No password set up: refuse everyone rather than leave the app open
    return deny(503, 'The app password isn\u2019t set up yet. Add APP_PASSWORD in Netlify and redeploy.');
  }
  const headers = event.headers || {};
  let given = headers['x-app-key'] || '';
  try { given = decodeURIComponent(given); } catch (e) {}
  if (!given || !crypto.timingSafeEqual(sha(given), sha(expected))) {
    return deny(401, 'Wrong or missing app password.');
  }
  return null;
}

module.exports = { requireAppKey };

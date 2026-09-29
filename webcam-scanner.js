/*
 * webcam-scanner.js
 * Reads Ford part numbers off box labels with a webcam (for boxes with no barcode).
 * Needs Tesseract.js v5 loaded on the page first.
 *
 * Usage:
 *   const scanner = WebcamScanner.mount(document.getElementById('webcam-scan'), {
 *     onConfirm: (partNumber, info) => runLookup(partNumber)   // your existing search
 *   });
 */
(function (global) {
  'use strict';

  /* ---------------- Ford part number parsing ---------------- */

  // OCR mix-ups, fixed by position using Ford's number format.
  const TO_DIGIT = { O: '0', Q: '0', I: '1', L: '1', S: '5', Z: '2', B: '8', G: '6' };
  const TO_LETTER = { '0': 'O', '1': 'I', '5': 'S', '2': 'Z', '8': 'B', '6': 'G' };

  // prefix (4) - basic (4-7, starts with a digit) - suffix (1-3 letters)
  const PN_RE = /(?<![A-Z0-9])([A-Z0-9]{4})\s?(-?)\s?([0-9OQILSZBG][A-Z0-9]{3,6})\s?(-?)\s?([A-Z0-9]{1,3})(?![A-Z0-9])/g;

  function fixPrefix(p) {
    const c = p.split('');
    if (/[0-9]/.test(c[3])) c[3] = TO_LETTER[c[3]] || c[3]; // 4th char is a letter, usually Z
    return c.join('');
  }

  function fixBasic(b) {
    const c = b.split('');
    c[0] = TO_DIGIT[c[0]] || c[0];                       // always starts with a digit
    for (let i = 1; i < c.length; i++) {
      if (c[i] === 'O' || c[i] === 'Q') c[i] = '0';      // Ford avoids O and I in basic numbers
      if (c[i] === 'I') c[i] = '1';
    }
    const last = c.length - 1;                           // basic numbers end in a digit
    c[last] = TO_DIGIT[c[last]] || c[last];
    return c.join('');
  }

  function fixSuffix(s) {
    return s.split('').map(ch => TO_LETTER[ch] || ch).join('');
  }

  function parseFordPartNumber(text) {
    const clean = String(text || '')
      .toUpperCase()
      .replace(/[=_–—.·:|]/g, '-')
      .replace(/[ \t]+/g, ' ');
    const seen = new Map();
    let m;
    PN_RE.lastIndex = 0;
    while ((m = PN_RE.exec(clean)) !== null) {
      const prefix = fixPrefix(m[1]);
      const basic = fixBasic(m[3]);
      const suffix = fixSuffix(m[5]);
      if (!/[A-Z]/.test(prefix) || !/^[A-Z]$/.test(prefix[3])) continue;
      if (!/^[0-9]/.test(basic) || !/^[A-Z]{1,3}$/.test(suffix)) continue;

      let score = 0;
      if (prefix[3] === 'Z') score += 3;                 // service part numbers end the prefix in Z
      if (m[2] && m[4]) score += 2;                      // dashes were printed
      if (/^[A-Z]+$/.test(m[5])) score += 1;             // suffix read cleanly as letters

      const partNumber = `${prefix}-${basic}-${suffix}`;
      if (!seen.has(partNumber) || seen.get(partNumber).score < score) {
        seen.set(partNumber, { partNumber, score, raw: m[0].trim() });
      }
    }
    const candidates = [...seen.values()].sort((a, b) => b.score - a.score);
    return { best: candidates[0] ? candidates[0].partNumber : null, candidates };
  }

  /* ---------------- Styles ---------------- */

  const CSS = `
  .ws { --ws-ink:#1C2430; --ws-steel:#5B6673; --ws-line:#C9CFD6; --ws-blue:#1F4E8C; --ws-tape:#F2C230;
        font-family: 'Barlow', 'Segoe UI', system-ui, sans-serif; color: var(--ws-ink); max-width: 960px; }
  .ws-bar { display:flex; flex-wrap:wrap; gap:.75rem 1.5rem; align-items:center; margin-bottom:.75rem; }
  .ws-bar select { font:inherit; padding:.4rem .5rem; border:1px solid var(--ws-line); border-radius:4px; background:#fff; }
  .ws-bar label { display:flex; gap:.5rem; align-items:center; }
  .ws-stage { position:relative; overflow:hidden; background:var(--ws-ink); border-radius:6px; line-height:0; }
  .ws-video { width:100%; height:auto; display:block; }
  .ws-guide { position:absolute; left:10%; top:35%; width:80%; height:30%;
              border:3px dashed var(--ws-tape); border-radius:4px;
              box-shadow:0 0 0 9999px rgba(28,36,48,.45); pointer-events:none; }
  .ws-status { position:absolute; left:.75rem; bottom:.75rem; line-height:1.3; font-size:.9rem;
               background:rgba(28,36,48,.8); color:#fff; padding:.35rem .6rem; border-radius:4px; }
  .ws-actions, .ws-row { display:flex; flex-wrap:wrap; gap:.5rem; margin-top:.75rem; }
  .ws button { font:inherit; font-weight:600; padding:.55rem 1rem; border-radius:4px; cursor:pointer;
               border:2px solid var(--ws-blue); background:#fff; color:var(--ws-blue); }
  .ws button.ws-primary { background:var(--ws-blue); color:#fff; }
  .ws button:disabled { opacity:.5; cursor:default; }
  .ws button:focus-visible, .ws input:focus-visible, .ws select:focus-visible { outline:3px solid var(--ws-tape); outline-offset:2px; }
  .ws-result { margin-top:1rem; padding:1rem; border:1px solid var(--ws-line); border-radius:6px; background:#fff; }
  .ws-result[hidden] { display:none; }
  .ws-result label { display:block; font-weight:600; margin-bottom:.35rem; }
  .ws-pn { font-family:'Barlow Condensed', 'Arial Narrow', sans-serif; font-size:2rem; font-weight:600;
           letter-spacing:.04em; width:100%; max-width:22ch; padding:.3rem .5rem;
           border:2px solid var(--ws-line); border-radius:4px; text-transform:uppercase; }
  .ws-msg { color:var(--ws-steel); margin:.5rem 0 0; }
  .ws-alts button { font-weight:500; padding:.3rem .6rem; border-width:1px; }
  .ws details { margin-top:.75rem; color:var(--ws-steel); }
  .ws pre { white-space:pre-wrap; font-size:.85rem; margin:.4rem 0 0; }
  `;

  function injectStyles() {
    if (document.getElementById('ws-styles')) return;
    const s = document.createElement('style');
    s.id = 'ws-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------------- Scanner UI ---------------- */

  const GUIDE = { x: 0.10, y: 0.35, w: 0.80, h: 0.30 }; // must match .ws-guide in CSS
  const MOTION = 12, STILL = 3, STILL_FRAMES = 5;     // auto-capture tuning (0-255 brightness scale)

  let workerPromise = null;
  function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        const w = await global.Tesseract.createWorker('eng');
        await w.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-= ',
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1'
        });
        return w;
      })();
    }
    return workerPromise;
  }

  function mount(container, opts) {
    if (!global.Tesseract) throw new Error('Load Tesseract.js before webcam-scanner.js');
    const onConfirm = opts && opts.onConfirm;
    if (typeof onConfirm !== 'function') throw new Error('mount() needs an onConfirm(partNumber) function');
    injectStyles();

    container.innerHTML = `
      <div class="ws">
        <div class="ws-bar">
          <select class="ws-cam" aria-label="Camera"></select>
          <label><input type="checkbox" class="ws-auto" checked> Read automatically when a box is set down</label>
        </div>
        <div class="ws-stage">
          <video class="ws-video" playsinline muted></video>
          <div class="ws-guide"></div>
          <div class="ws-status" role="status">Starting camera…</div>
        </div>
        <div class="ws-actions">
          <button type="button" class="ws-read ws-primary">Read label</button>
        </div>
        <div class="ws-result" hidden>
          <label for="ws-pn">Part number</label>
          <input id="ws-pn" class="ws-pn" spellcheck="false" autocomplete="off">
          <p class="ws-msg"></p>
          <div class="ws-row ws-alts"></div>
          <div class="ws-row">
            <button type="button" class="ws-search ws-primary">Search</button>
            <button type="button" class="ws-again">Read again</button>
          </div>
          <details><summary>Text the camera read</summary><pre class="ws-raw"></pre></details>
        </div>
      </div>`;

    const $ = sel => container.querySelector(sel);
    const video = $('.ws-video'), camSel = $('.ws-cam'), autoBox = $('.ws-auto');
    const statusEl = $('.ws-status'), readBtn = $('.ws-read');
    const resultEl = $('.ws-result'), pnInput = $('.ws-pn'), msgEl = $('.ws-msg');
    const altsEl = $('.ws-alts'), rawEl = $('.ws-raw');

    let stream = null, busy = false, lastInfo = null, timer = null;
    let prevFrame = null, sawMotion = true, stillCount = 0;
    const small = document.createElement('canvas');
    small.width = 64; small.height = 36;
    const smallCtx = small.getContext('2d', { willReadFrequently: true });

    const setStatus = t => { statusEl.textContent = t; };

    async function startCamera(deviceId) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      const video_ = deviceId ? { deviceId: { exact: deviceId }, ...size } : size;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
      } catch (e) {
        setStatus('Camera blocked or not found. Allow camera access in the browser, then reload.');
        return;
      }
      video.srcObject = stream;
      await video.play();
      await listCameras();
      setStatus(autoBox.checked ? 'Set a box under the camera' : 'Line up the part number in the yellow box');
    }

    async function listCameras() {
      const current = stream.getVideoTracks()[0].getSettings().deviceId;
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      camSel.innerHTML = cams.map((c, i) =>
        `<option value="${c.deviceId}" ${c.deviceId === current ? 'selected' : ''}>${c.label || 'Camera ' + (i + 1)}</option>`
      ).join('');
    }

    function grabGuide(invert) {
      const vw = video.videoWidth, vh = video.videoHeight;
      const sx = Math.round(vw * GUIDE.x), sy = Math.round(vh * GUIDE.y);
      const sw = Math.round(vw * GUIDE.w), sh = Math.round(vh * GUIDE.h);
      const scale = sw < 1200 ? 2 : 1;                   // upscale small crops for better OCR
      const c = document.createElement('canvas');
      c.width = sw * scale; c.height = sh * scale;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);

      // Grayscale + contrast stretch (2nd–98th percentile) so faded labels read better.
      const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
      const gray = new Uint8Array(d.length / 4), hist = new Uint32Array(256);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
        gray[j] = g; hist[g]++;
      }
      const total = gray.length;
      let lo = 0, hi = 255, acc = 0;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
      acc = 0;
      for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
      const range = Math.max(hi - lo, 1);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        let v = Math.min(255, Math.max(0, (gray[j] - lo) * 255 / range));
        if (invert) v = 255 - v;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
      return c;
    }

    async function read(isAuto) {
      if (busy || !video.videoWidth) return;
      busy = true; readBtn.disabled = true;
      setStatus('Reading label…');
      try {
        const worker = await getWorker();
        let text = (await worker.recognize(grabGuide(false))).data.text;
        let parsed = parseFordPartNumber(text);
        if (!parsed.best) {                              // try again for light text on a dark label
          const text2 = (await worker.recognize(grabGuide(true))).data.text;
          const parsed2 = parseFordPartNumber(text2);
          if (parsed2.best) { text = text2; parsed = parsed2; }
        }
        if (!parsed.best && isAuto) {                    // empty bench or unreadable: wait quietly
          setStatus('No part number found. Adjust the box or click Read label.');
          return;
        }
        showResult(parsed, text);
      } catch (e) {
        setStatus('Could not read the label. Check your internet connection (the reader downloads once), then try again.');
      } finally {
        busy = false; readBtn.disabled = false;
      }
    }

    function showResult(parsed, text) {
      lastInfo = { raw: text, candidates: parsed.candidates };
      pnInput.value = parsed.best || '';
      msgEl.textContent = parsed.best
        ? 'Check the number against the label, then press Enter.'
        : 'No Ford part number found. Move the label inside the yellow box and read again, or type it in.';
      altsEl.innerHTML = '';
      parsed.candidates.slice(1, 4).forEach(c => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = c.partNumber;
        b.addEventListener('click', () => { pnInput.value = c.partNumber; pnInput.focus(); });
        altsEl.appendChild(b);
      });
      rawEl.textContent = text.trim() || '(nothing)';
      resultEl.hidden = false;
      setStatus('Waiting for you to confirm');
      pnInput.focus(); pnInput.select();
    }

    function confirm() {
      const typed = pnInput.value.trim().toUpperCase();
      if (!typed) { pnInput.focus(); return; }
      const parsed = parseFordPartNumber(typed);
      const partNumber = parsed.best || typed;
      resultEl.hidden = true;
      sawMotion = false; stillCount = 0;                 // wait for the next box before auto-reading
      setStatus(autoBox.checked ? 'Set the next box under the camera' : 'Line up the part number in the yellow box');
      onConfirm(partNumber, lastInfo || { raw: typed, candidates: parsed.candidates });
    }

    // Auto-capture: after movement, wait for the scene to hold still, then read once.
    function watch() {
      if (!autoBox.checked || busy || !resultEl.hidden || !video.videoWidth) return;
      smallCtx.drawImage(video, 0, 0, small.width, small.height);
      const d = smallCtx.getImageData(0, 0, small.width, small.height).data;
      const frame = new Uint8Array(d.length / 4);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) frame[j] = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (prevFrame) {
        let diff = 0;
        for (let j = 0; j < frame.length; j++) diff += Math.abs(frame[j] - prevFrame[j]);
        diff /= frame.length;
        if (diff > MOTION) { sawMotion = true; stillCount = 0; }
        else if (diff < STILL) stillCount++;
        if (sawMotion && stillCount >= STILL_FRAMES) { sawMotion = false; stillCount = 0; read(true); }
      }
      prevFrame = frame;
    }

    readBtn.addEventListener('click', () => read(false));
    $('.ws-again').addEventListener('click', () => { resultEl.hidden = true; read(false); });
    $('.ws-search').addEventListener('click', confirm);
    pnInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } });
    camSel.addEventListener('change', () => startCamera(camSel.value));
    autoBox.addEventListener('change', () => {
      sawMotion = true; stillCount = 0;
      setStatus(autoBox.checked ? 'Set a box under the camera' : 'Line up the part number in the yellow box');
    });

    startCamera();
    getWorker();                                          // start downloading the reader right away
    timer = setInterval(watch, 200);

    return {
      read: () => read(false),
      destroy() {
        clearInterval(timer);
        if (stream) stream.getTracks().forEach(t => t.stop());
        container.innerHTML = '';
      }
    };
  }

  const api = { mount, parseFordPartNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WebcamScanner = api;
})(typeof window !== 'undefined' ? window : globalThis);

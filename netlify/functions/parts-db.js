   // netlify/functions/parts-db.js
   // Your own parts database (fitment, names, notes), stored on Netlify.
   //   GET    ?pn=E9SZ-6507-B      -> that part's saved record (or { found: false })
   //   POST   { pn, record }       -> save or replace a part's record
   //   DELETE ?pn=E9SZ-6507-B      -> delete a part's record
   //   GET    ?export=1            -> every saved record (backup)
   const { getStore, connectLambda } = require('@netlify/blobs');
   const { requireAppKey } = require('./utils/app-auth');

   const reply = (statusCode, obj) => ({
     statusCode,
     headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
     body: JSON.stringify(obj)
   });

   // One key per part number, ignoring dashes and spaces: "E9SZ6507B"
   const keyFor = pn => String(pn || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

   const clean = (s, max) => String(s || '').trim().slice(0, max);

   function cleanRecord(pn, r) {
     const fits = (Array.isArray(r.fits) ? r.fits : []).slice(0, 500).map(f => ({
       make: clean(f.make, 40),
       model: clean(f.model, 80),
       years: clean(f.years, 9)
     })).filter(f => f.make && f.model && /^\d{4}(-\d{4})?$/.test(f.years));
     return {
       pn: clean(pn, 30).toUpperCase(),
       name: clean(r.name, 120),
       fits,
       buyerNotes: clean(r.buyerNotes, 1000),
       privateNotes: clean(r.privateNotes, 4000),
       source: /^https?:\/\//i.test(String(r.source || '')) ? clean(r.source, 500) : '',
       savedAt: Date.now()
     };
   }

   exports.handler = async (event) => {
     const denied = requireAppKey(event);   // app password check
     if (denied) return denied;

     try {
       connectLambda(event);
       const store = getStore({ name: 'parts', consistency: 'strong' });
       const qs = event.queryStringParameters || {};

       if (event.httpMethod === 'GET' && qs.export) {
         const { blobs } = await store.list();
         const records = [];
         for (let i = 0; i < blobs.length; i += 25) {
           const batch = await Promise.all(blobs.slice(i, i + 25).map(b => store.get(b.key, { type: 'json' })));
           batch.forEach(r => { if (r) records.push(r); });
         }
         return reply(200, { count: records.length, records });
       }

       if (event.httpMethod === 'GET') {
         const key = keyFor(qs.pn);
         if (key.length < 5) return reply(400, { message: 'Add ?pn= with a part number.' });
         const record = await store.get(key, { type: 'json' });
         return reply(200, record ? { found: true, record } : { found: false });
       }

       if (event.httpMethod === 'POST') {
         const { pn, record } = JSON.parse(event.body || '{}');
         const key = keyFor(pn);
         if (key.length < 5 || !record) return reply(400, { message: 'Send { pn, record }.' });
         const saved = cleanRecord(pn, record);
         if (!saved.name) return reply(400, { message: 'The part needs a name.' });
         await store.setJSON(key, saved);
         return reply(200, { saved: true, record: saved });
       }

       if (event.httpMethod === 'DELETE') {
         const key = keyFor(qs.pn);
         if (key.length < 5) return reply(400, { message: 'Add ?pn= with a part number.' });
         await store.delete(key);
         return reply(200, { deleted: true });
       }

       return reply(405, { message: 'Use GET, POST, or DELETE.' });
     } catch (e) {
       return reply(500, { message: 'Database error: ' + e.message });
     }
   };

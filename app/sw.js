/* Garage Pro — offline shell.
 *  Keeps the web app itself (page, scripts, fonts, icons) available with no connection.
 *  It NEVER touches Firestore, sign-in, Cloudinary, e-mail or any other API request — your data is cached by Firestore's own
 *  on-device storage, and those requests go straight to the network as usual.
 *  Online: pages and scripts come from the network (so you always get the newest version), with the cached copy as the fallback
 *  when the network is down or too slow (3.5 s).
 *  To switch it off: open the app once with ?nosw=1 in the address.
 */
const CACHE = 'gp-shell-v1';
const CDN_HOSTS = new Set(['www.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const PRECACHE = ['./', './index.html', '../vendor/qrcode.min.js'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(PRECACHE.map(u => c.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms));
async function put(req, res) {
  try { if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(CACHE); await c.put(req, res.clone()); } } catch (_) {}
  return res;
}
async function networkFirst(req) {
  try { return await put(req, await Promise.race([fetch(req), timeout(3500)])); }
  catch (_) {
    const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') { const shell = (await caches.match('./index.html')) || (await caches.match('./')); if (shell) return shell; }
    return fetch(req);                    // nothing cached: let the browser show its normal error
  }
}
async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) { fetch(req).then(r => put(req, r)).catch(() => {}); return hit; }
  return put(req, await fetch(req));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  const same = u.origin === self.location.origin;
  if (!same && !CDN_HOSTS.has(u.hostname)) return;                       // Firestore, Auth, Cloudinary, APIs …: untouched
  if (u.hostname === 'www.gstatic.com' && !u.pathname.startsWith('/firebasejs/')) return;
  if (same && /\/(__\/|api\/)/.test(u.pathname)) return;                // Firebase-hosting reserved paths and any /api/ route
  if (!same) { e.respondWith(cacheFirst(req)); return; }                 // versioned CDN files and fonts never change
  e.respondWith(networkFirst(req));
});

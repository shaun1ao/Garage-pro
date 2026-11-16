/* Garage Pro — camera scanner for VINs.
 *
 *  GPScan.scanVin()      → Promise<{ vin, how: 'barcode'|'text', verified: bool } | null>
 *  GPScan.decodeVin(vin) → Promise<{ ok, make, model, year, trim, fuel, body, engine } >
 *
 * HOW IT WORKS
 *  • One camera view reads BOTH barcodes (Code 39 / Code 128 / DataMatrix / QR — ZXing) and printed or etched text
 *    (OCR — Tesseract) at the same time, so a VIN sticker barcode and a VIN stamped on the windscreen use the same button.
 *  • Everything runs on the device. The photo never leaves the phone. Both libraries are hosted on our own site (vendor/),
 *    not on a third-party CDN. The text-recognition files (~7 MB) are fetched only the first time someone scans text.
 *  • A VIN with a valid check digit is accepted straight away; a text read that can't be verified is shown for the user
 *    to confirm or correct before it is used.
 *  • Decoding a VIN to make / model / year uses the free US NHTSA vPIC service (the VIN — and nothing else — is sent).
 *    It is strong for US-market vehicles and patchy elsewhere; when it can't decode, only the VIN is filled in.
 */
(function () {
  'use strict';
  var ROOT = (function () { try { var s = document.currentScript && document.currentScript.src; return s ? s.replace(/[^\/]*$/, '') : '/'; } catch (e) { return '/'; } })();
  var VIN_OK = /^[A-HJ-NPR-Z0-9]{17}$/;

  // ───────── VIN logic (pure — unit-testable) ─────────
  var TRANS = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  var WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  function checkDigitOk(v) {
    if (!VIN_OK.test(v)) return false;
    var sum = 0; for (var i = 0; i < 17; i++) { var c = v[i], n = /\d/.test(c) ? +c : TRANS[c]; sum += n * WEIGHTS[i]; }
    var r = sum % 11; return v[8] === (r === 10 ? 'X' : String(r));
  }
  // letters/digits OCR confuses with each other
  var SWAP = { '0': ['D'], D: ['0'], '1': ['L', 'T'], L: ['1'], T: ['1'], '2': ['Z'], Z: ['2'], '5': ['S'], S: ['5'], '8': ['B'], B: ['8'], '6': ['G'], G: ['6'], '7': ['Z'], U: ['V'], V: ['U'] };
  function fixVinChars(s) { return s.replace(/[OQ]/g, '0').replace(/I/g, '1'); }          // O, Q and I never appear in a VIN
  function tryRepair(v) {                                                                    // one swap that makes the check digit valid
    var hits = [];
    for (var i = 0; i < 17; i++) { var alts = SWAP[v[i]] || []; for (var k = 0; k < alts.length; k++) { var c = v.slice(0, i) + alts[k] + v.slice(i + 1); if (checkDigitOk(c)) hits.push(c); } }
    return hits.length === 1 ? hits[0] : '';
  }
  // find a VIN in free text (barcode payload or OCR output)
  function extractVin(text) {
    var up = String(text || '').toUpperCase();
    var toks = up.replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean), cands = [], long18 = [];
    for (var i = 0; i < toks.length; i++) {                      // single tokens and runs of adjacent tokens that add up to 17
      var s = ''; for (var j = i; j < toks.length && s.length < 19; j++) { s += toks[j]; if (s.length === 17 || (s.length === 18 && s[0] === 'I')) cands.push(s.length === 18 ? s.slice(1) : s); else if (s.length === 18) long18.push(s); }
    }
    for (var q = 0; q < long18.length; q++) for (var k = 0; k < 18; k++) { var dv = fixVinChars(long18[q].slice(0, k) + long18[q].slice(k + 1)); if (VIN_OK.test(dv) && checkDigitOk(dv)) return { vin: dv, verified: true, repaired: true }; }   // OCR added one stray character
    var best = null;
    for (var n = 0; n < cands.length; n++) {
      var v = fixVinChars(cands[n]); if (!VIN_OK.test(v)) continue;
      if (checkDigitOk(v)) return { vin: v, verified: true };
      var rep = tryRepair(v); if (rep) return { vin: rep, verified: true, repaired: true };
      if (!best) best = { vin: v, verified: false };
    }
    return best;
  }


  // ───────── VIN decode (NHTSA vPIC) ─────────
  var titleCase = function (s) { return String(s || '').toLowerCase().replace(/(^|[\s\-\/])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); };
  function decodeVin(vin) {
    if (!VIN_OK.test(String(vin || '').toUpperCase())) return Promise.resolve({ ok: false });
    var ctl = typeof AbortController === 'function' ? new AbortController() : null, t = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, 7000);
    return fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + encodeURIComponent(vin) + '?format=json', ctl ? { signal: ctl.signal } : {}).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(t); var r = (j && j.Results && j.Results[0]) || {};
      if (!r.Make || !/^\d{4}$/.test(r.ModelYear || '')) return { ok: false };
      var fuel = /diesel/i.test(r.FuelTypePrimary) ? 'Diesel' : /compressed natural|cng/i.test(r.FuelTypePrimary) ? 'CNG' : /liquefied petroleum|lpg/i.test(r.FuelTypePrimary) ? 'LPG' : /electric/i.test(r.FuelTypePrimary) && !/gasoline/i.test(r.FuelTypeSecondary || '') ? 'Electric' : (/hybrid|phev|hev/i.test(r.ElectrificationLevel || '') || /electric/i.test(r.FuelTypeSecondary || '')) ? 'Hybrid' : /gasoline|flex/i.test(r.FuelTypePrimary) ? 'Petrol' : '';
      return { ok: true, make: titleCase(r.Make), model: r.Model || '', year: r.ModelYear, trim: [r.Trim, r.Series].filter(function (x) { return x && x.trim(); })[0] || '', fuel: fuel, body: r.BodyClass || '', engine: [r.DisplacementL ? (+r.DisplacementL).toFixed(1) + 'L' : '', r.EngineCylinders ? r.EngineCylinders + 'cyl' : ''].filter(Boolean).join(' ') };
    }).catch(function () { clearTimeout(t); return { ok: false }; });
  }

  // ───────── libraries (self-hosted, loaded on demand) ─────────
  var loaded = {};
  function loadScript(src) { return loaded[src] || (loaded[src] = new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); })); }
  function getZXing() { return typeof ZXingBrowser !== 'undefined' ? Promise.resolve() : loadScript(ROOT + 'vendor/zxing-browser.min.js'); }
  // Text reader: ~3.5 MB over the wire the FIRST time (the language data is then kept in the browser's IndexedDB, the script
  // files in its normal cache), so every later scan starts in well under a second. It is started early — while the camera
  // opens, never at page load, and is shut down after 3 idle minutes to free memory.
  var ocrWorker = null, ocrPromise = null, idleTimer = null, onProgress = null;
  function getOcr() {
    clearTimeout(idleTimer); idleTimer = setTimeout(function () { try { ocrWorker && ocrWorker.terminate(); } catch (e) {} ocrWorker = null; ocrPromise = null; }, 180000);
    if (ocrWorker) return Promise.resolve(ocrWorker);
    if (!ocrPromise) ocrPromise = loadScript(ROOT + 'vendor/ocr/tesseract.min.js').then(function () {
      return Tesseract.createWorker('eng', 1, { workerPath: ROOT + 'vendor/ocr/worker.min.js', corePath: ROOT + 'vendor/ocr', langPath: ROOT + 'vendor/ocr', gzip: true, cacheMethod: 'write',
        logger: function (m) { try { onProgress && m && onProgress(m); } catch (e) {} } });
    }).then(function (w) { ocrWorker = w; return w; }).catch(function (e) { ocrPromise = null; throw e; });
    return ocrPromise;
  }
  function warmOcr() { getOcr().catch(function () {}); }
  // grayscale + contrast stretch, scaled so text is ~40px tall — OCR does much better on this than on the raw frame
  function prep(srcCanvas, box) {
    var sw = srcCanvas.width, sh = srcCanvas.height, x = Math.round(sw * box.x), y = Math.round(sh * box.y), w = Math.round(sw * box.w), h = Math.round(sh * box.h);
    var scale = Math.min(2, 1400 / w), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    var g = c.getContext('2d'); g.drawImage(srcCanvas, x, y, w, h, 0, 0, c.width, c.height);
    var img = g.getImageData(0, 0, c.width, c.height), d = img.data, lo = 255, hi = 0, i;
    for (i = 0; i < d.length; i += 4) { var v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; d[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    var span = Math.max(40, hi - lo);
    for (i = 0; i < d.length; i += 4) { var n = Math.max(0, Math.min(255, (d[i] - lo) * 255 / span)); d[i] = d[i + 1] = d[i + 2] = n; }
    g.putImageData(img, 0, 0); return c;
  }
  function ocrText(canvas, mode, whitelist) {
    return getOcr().then(function (w) { return w.setParameters({ tessedit_char_whitelist: whitelist, tessedit_pageseg_mode: mode === 'line' ? '7' : mode === 'block' ? '6' : '11', user_defined_dpi: '300' }).then(function () { return w.recognize(canvas); }); }).then(function (r) { return (r && r.data && r.data.text) || ''; });
  }
  var VIN_WL = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789IOQ ';

  // ───────── camera dialog ─────────
  var CSS = '#gpsc{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:12px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff}' +
    '#gpsc .bx{width:100%;max-width:560px;background:#11181c;border:1px solid #2a343a;border-radius:16px;overflow:hidden}#gpsc .hd{padding:12px 16px;font-weight:700;display:flex;justify-content:space-between;align-items:center}' +
    '#gpsc .vw{position:relative;background:#000;aspect-ratio:4/3}#gpsc video{width:100%;height:100%;object-fit:cover;display:block}' +
    '#gpsc .gd{position:absolute;left:5%;right:5%;top:36%;height:28%;border:3px solid #7db0f5;border-radius:10px;box-shadow:0 0 0 999px rgba(0,0,0,.35)}' +
    '#gpsc .st{padding:10px 16px;min-height:44px;color:#b2bfc4}#gpsc .bt{display:flex;gap:8px;flex-wrap:wrap;padding:0 16px 16px}' +
    '#gpsc button,#gpsc .fb{font:600 14px system-ui,sans-serif;padding:10px 14px;border-radius:10px;border:1.5px solid #7db0f5;background:transparent;color:#fff;cursor:pointer}#gpsc button.pr{background:#7db0f5;color:#0b1d36}' +
    '#gpsc input[type=text],#gpsc select{width:100%;padding:11px;border-radius:10px;border:1px solid #3a464d;background:#192024;color:#fff;font:16px system-ui}#gpsc input[type=file]{display:none}' +
    '#gpsc .rs{padding:4px 16px 8px}#gpsc .ok{color:#52c7a0}#gpsc .wn{color:#f0b35a}#gpsc button:focus-visible,#gpsc input:focus-visible,#gpsc select:focus-visible{outline:3px solid #fff;outline-offset:2px}';
  function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in (attrs || {})) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // Resolves with the confirmed raw text + how it was read, or null if cancelled.
  function cameraDialog(title, hint) {
    return new Promise(function (resolve) {
      var root = el('div', { id: 'gpsc', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }), stream = null, reader = null, ctl = null, timer = null, busy = false, done = false, ocrReady = false, torchOn = false;
      var style = el('style'); style.textContent = CSS; root.appendChild(style);
      var box = el('div', { 'class': 'bx' }); root.appendChild(box);
      box.innerHTML = '<div class="hd"><span>' + esc(title) + '</span><button type="button" id="gpX" aria-label="Close">✕</button></div><div class="vw"><video playsinline muted autoplay></video><div class="gd' + '' + '"></div></div><div class="st" id="gpSt" aria-live="polite"></div><div class="rs" id="gpRs"></div><div class="bt"><button type="button" class="pr" id="gpGo">Read now</button><label class="fb">📷 Use a photo<input type="file" accept="image/*" capture="environment" id="gpFile"></label><button type="button" id="gpTorch" style="display:none">🔦 Light</button><button type="button" id="gpType">Type it instead</button></div>';
      document.body.appendChild(root);
      var video = box.querySelector('video'), st = box.querySelector('#gpSt'), rs = box.querySelector('#gpRs');
      function status(t, cls) { st.className = 'st ' + (cls || ''); st.textContent = t; }
      function finish(v) { if (done) return; done = true; clearInterval(timer); try { ctl && ctl.stop && ctl.stop(); } catch (e) {} try { reader && reader.reset && reader.reset(); } catch (e) {} try { stream && stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} try { video.srcObject = null; } catch (e) {} root.remove(); resolve(v); }
      box.querySelector('#gpX').onclick = box.querySelector('#gpType').onclick = function () { finish(null); };
      root.addEventListener('keydown', function (e) { if (e.key === 'Escape') finish(null); });
      function accept(text, how, verified) { if (done) return; clearInterval(timer); try { ctl && ctl.stop && ctl.stop(); } catch (e) {} showConfirm(text, how, verified); }
      // confirmation card (editable)
      function showConfirm(text, how, verified) {
        var reading = true;
        rs.innerHTML = '<label style="display:block;font-weight:600;margin:6px 0 4px">' + 'VIN read' + ' — check it, fix it if needed</label><input type="text" id="gpTx" value="' + esc(text) + '" maxlength="17" style="text-transform:uppercase;letter-spacing:.06em;font-family:ui-monospace,Menlo,monospace" autocomplete="off" autocapitalize="characters" spellcheck="false">' +
          '<div id="gpHint" class="' + (verified ? 'ok' : 'wn') + '" style="margin-top:6px">' + (verified ? '✓ Valid VIN (check digit matches)' : 'Could not verify this VIN automatically — please compare it with the car.')+ '</div>';
        box.querySelector('.bt').innerHTML = '<button type="button" class="pr" id="gpUse">Use this</button><button type="button" id="gpAgain">Scan again</button>';
        status(how === 'barcode' ? 'Barcode read.' : 'Text read.', 'ok');
        var tx = box.querySelector('#gpTx'); tx.focus(); tx.select();
        if (reading) tx.oninput = function () { var v = fixVinChars(tx.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); var h = box.querySelector('#gpHint'); if (v.length === 17) { var ok = VIN_OK.test(v) && checkDigitOk(v); h.className = ok ? 'ok' : 'wn'; h.textContent = ok ? '✓ Valid VIN (check digit matches)' : 'Check digit does not match — VINs made outside North America often do not use it, so compare with the car.'; } else { h.className = 'wn'; h.textContent = v.length + ' of 17 characters'; } };
        box.querySelector('#gpUse').onclick = function () { var v = tx.value.toUpperCase().trim(); if (reading) { v = fixVinChars(v.replace(/[^A-Z0-9]/g, '')); if (!VIN_OK.test(v)) { var h = box.querySelector('#gpHint'); h.className = 'wn'; h.textContent = 'A VIN has exactly 17 letters and digits (no I, O or Q).'; return; } } finish({ text: v, how: how, verified: checkDigitOk(v) }); };
        box.querySelector('#gpAgain').onclick = function () { finish({ again: true }); };
      }
      // handle a candidate string from either reader
      function consider(text, how) {
        var f = extractVin(text); if (f && (how === 'barcode' || f.verified)) return accept(f.vin, how, f.verified); return f;
      }
      var lastGuess = null;
      function ocrFrame(canvas, full) {
        if (busy || done) return Promise.resolve();
        busy = true; status(ocrReady ? 'Reading text…' : 'Getting the text reader ready (first time only, a few MB)…');
        var box1 = full ? { x: 0, y: 0, w: 1, h: 1 } : { x: 0.05, y: 0.36, w: 0.9, h: 0.28 };
        return Promise.resolve().then(function () { ocrReady = true; var pc = prep(canvas, box1); return ocrText(pc, 'sparse', VIN_WL).then(function (t) { var f = extractVin(t); if (!f) return ocrText(pc, 'block', VIN_WL).then(extractVin); return f; }); })
          .then(function (r) {
            busy = false; if (done) return;
            if (r && r.verified) return accept(r.vin, 'text', true); if (r) { lastGuess = r; status('Found something that looks like a VIN but could not verify it. Hold steady, or press Read now to use it.', 'wn'); if (full) return accept(r.vin, 'text', false); } else status(full ? 'No VIN found in that photo — try again closer, or type it.' : 'Looking for a barcode or text…');
          }).catch(function (e) { busy = false; status('The text reader could not start (' + (e && e.message || e) + '). You can still scan barcodes or type it.', 'wn'); });
      }
      function snapshot() { var c = document.createElement('canvas'); c.width = video.videoWidth || 1280; c.height = video.videoHeight || 720; c.getContext('2d').drawImage(video, 0, 0, c.width, c.height); return c; }
      box.querySelector('#gpGo').onclick = function () { if (video.videoWidth) { if (lastGuess && !busy) return accept(lastGuess.vin, 'text', lastGuess.verified); ocrFrame(snapshot(), false); } else status('The camera is not ready yet.'); };
      box.querySelector('#gpFile').onchange = function (e) {
        var f = e.target.files && e.target.files[0]; if (!f) return; status('Reading the photo…');
        var img = new Image(), url = URL.createObjectURL(f);
        img.onload = function () {
          var c = document.createElement('canvas'), sc = Math.min(1, 2200 / Math.max(img.width, img.height)); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          var pre = getZXing().then(function () { var rd = new ZXingBrowser.BrowserMultiFormatReader(hints()); return rd.decodeFromCanvas ? rd.decodeFromCanvas(c) : Promise.reject(); }).then(function (r) { return r && r.getText ? r.getText() : ''; }).catch(function () { return ''; });
          pre.then(function (txt) { if (txt) { var f2 = extractVin(txt); if (f2) return accept(f2.vin, 'barcode', f2.verified); } return ocrFrame(c, true); });
        };
        img.onerror = function () { status('That file could not be opened as a picture.', 'wn'); }; img.src = url;
      };
      function hints() { var h = new Map(), F = ZXingBrowser.BarcodeFormat; h.set(ZXingBrowser.DecodeHintType.POSSIBLE_FORMATS, [F.CODE_39, F.CODE_128, F.DATA_MATRIX, F.QR_CODE, F.PDF_417].filter(Boolean)); h.set(ZXingBrowser.DecodeHintType.TRY_HARDER, true); return h; }
      onProgress = function (m) { if (!ocrReady && !done && !busy && m.status && /load|initiali/i.test(m.status)) status('Getting the text reader ready… ' + (m.status.indexOf('traineddata') >= 0 ? Math.round((m.progress || 0) * 100) + '%' : '')); };
      status(hint || 'Starting the camera…');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status('This browser can’t open the camera here — use “Use a photo”, or type it.', 'wn'); return; }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(function (s) {
        if (done) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s; video.srcObject = s; video.play().catch(function () {});
        try { var tr = s.getVideoTracks()[0], cap = tr.getCapabilities && tr.getCapabilities(); if (cap && cap.torch) { var tb = box.querySelector('#gpTorch'); tb.style.display = ''; tb.onclick = function () { torchOn = !torchOn; tr.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(function () {}); }; } } catch (e) {}
        status('Point at the VIN barcode or the printed VIN — it reads both. Hold steady.');
        {
          getZXing().then(function () { reader = new ZXingBrowser.BrowserMultiFormatReader(hints()); return reader.decodeFromStream(s, video, function (res) { if (res && !done) consider(res.getText(), 'barcode'); }); }).then(function (c) { ctl = c; }).catch(function () {});
          // text reader: pre-load now, then look every ~2.5 s while no barcode has been found
          // barcodes need no text reader, so give them a head start; if nothing has scanned after ~1.2 s, start fetching it
          setTimeout(function () { if (!done) getOcr().then(function () { ocrReady = true; if (!busy && !done) status('Point at the VIN barcode or the printed VIN — it reads both. Hold steady.'); }).catch(function () {}); }, 1200);
          timer = setInterval(function () { if (!busy && !done && video.videoWidth && ocrReady) ocrFrame(snapshot(), false); }, 2500);
        }
      }).catch(function (e) { status(e && e.name === 'NotAllowedError' ? 'Camera permission was refused. Allow it in the browser, or use “Use a photo”.' : 'Could not open the camera. Use “Use a photo”, or type it.', 'wn'); });
    });
  }
  function scanLoop(title, hint) { return cameraDialog(title, hint).then(function (r) { return r && r.again ? scanLoop(title, hint) : r; }); }

  // ───────── public: VIN ─────────
  function scanVin() { return scanLoop('Scan VIN', 'Starting the camera…').then(function (r) { return r ? { vin: r.text, how: r.how, verified: r.verified } : null; }); }

  window.GPScan = { scanVin: scanVin, decodeVin: decodeVin, _t: { extractVin: extractVin, checkDigitOk: checkDigitOk, fixVinChars: fixVinChars } };
})();

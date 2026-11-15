/* Garage Pro — camera scanner for VINs and number plates.
 *
 *  GPScan.scanVin()                  → Promise<{ vin, how: 'barcode'|'text'|'photo', verified: bool } | null>
 *  GPScan.scanPlate({ regions, country, allowBH }) → Promise<{ region, plate, suffix, bh } | null>
 *  GPScan.decodeVin(vin)             → Promise<{ ok, make, model, year, trim, fuel, body, engine } >
 *
 * HOW IT WORKS
 *  • One camera view reads BOTH barcodes (Code 39 / Code 128 / DataMatrix / QR — ZXing) and printed or etched text
 *    (OCR — Tesseract) at the same time, so a VIN sticker barcode and a VIN stamped on the windscreen use the same button.
 *  • Everything runs on the device. The photo never leaves the phone. Both libraries are hosted on our own site (vendor/),
 *    not on a third-party CDN. The text-recognition files (~7 MB) are fetched only the first time someone scans text.
 *  • VIN: a VIN with a valid check digit is accepted straight away; a text read that can't be verified is shown for the user
 *    to confirm or correct before it is used.
 *  • Plate: the user picks the state / emirate FIRST; the text read is then fitted to that region's plate layout, and shown
 *    for confirmation (plate OCR is never trusted blindly).
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

  // ───────── plate logic (pure) ─────────
  var D2L = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '4': 'A' }, L2D = { O: '0', Q: '0', D: '0', I: '1', L: '1', T: '1', Z: '2', S: '5', B: '8', G: '6', A: '4' };
  var toL = function (s) { return s.replace(/\d/g, function (d) { return D2L[d] || d; }); }, toD = function (s) { return s.replace(/[A-Z]/g, function (c) { return L2D[c] || c; }); };
  function squash(t) { return String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  // returns { suffix, full, bh, ok } for the region the user picked
  function parsePlate(text, region, country) {
    var sq = squash(text); if (!sq) return null;
    if (country === 'IN') {
      var bh = /(\d{2})\s*B\s*H\s*(\d{4})\s*([A-Z]{1,2})/.exec(String(text).toUpperCase().replace(/[^A-Z0-9 ]/g, ' '));
      if (region === 'BH' || bh) { var m2 = /^(\d{2})BH(\d{4})([A-Z]{1,2})$/.exec(toD(sq.slice(0, 2)) + 'BH' + (sq.indexOf('BH') >= 0 ? toD(sq.slice(sq.indexOf('BH') + 2, sq.indexOf('BH') + 6)) + toL(sq.slice(sq.indexOf('BH') + 6)) : '')); if (m2) return { bh: true, year: m2[1], suffix: m2[2] + ' ' + m2[3], full: m2[1] + 'BH' + m2[2] + m2[3], ok: true }; if (region === 'BH') return { bh: true, suffix: sq, full: sq, ok: false }; }
      // SS DD [LLL] NNNN : the state letters may be missing if the user's chosen state was read as part of the plate
      var s = sq; if (region && region !== 'BH' && s.indexOf(region) !== 0 && s.length >= 9 && region === toL(s.slice(0, 2))) s = region + s.slice(2);
      if (s.length >= 9 && s.length <= 11) {
        var st = toL(s.slice(0, 2)), dist = toD(s.slice(2, 4)), num = toD(s.slice(-4)), ser = toL(s.slice(4, -4));
        if (/^[A-Z]{2}$/.test(st) && /^\d{2}$/.test(dist) && /^\d{4}$/.test(num) && /^[A-Z]{0,3}$/.test(ser)) {
          var good = !region || st === region || region === 'BH';
          return { state: st, suffix: [dist, ser, num].filter(Boolean).join(' '), full: st + dist + ser + num, ok: good, stateMismatch: !good };
        }
      }
      return { suffix: sq, full: sq, ok: false };
    }
    if (country === 'AE') { var toks = String(text).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean).filter(function (t) { return /^[0-9]+$/.test(t) || t.length <= 2; }); var cd = toks.length > 1 ? toks[0] : '', nb = toks.length > 1 ? toks.slice(1).join('') : (toks[0] || ''); var su = (cd ? cd + ' ' : '') + nb; return { suffix: su, full: su, ok: !!nb && nb.length <= 5 }; }
    if (country === 'QA') { var d = toD(sq).replace(/[^0-9]/g, ''); return { suffix: d, full: d, ok: d.length >= 3 && d.length <= 6 }; }
    if (country === 'PK') { var pm = /^([A-Z]{2,3})(\d{2})?(\d{3,4})$/.exec(toL(sq.replace(/\d+$/, '')) + (sq.match(/\d+$/) || [''])[0]); if (pm) { var ps = pm[1] + ' ' + (pm[2] ? pm[2] + ' ' : '') + pm[3]; return { suffix: ps, full: ps, ok: true }; } return { suffix: sq, full: sq, ok: false }; }
    return { suffix: sq, full: sq, ok: sq.length >= 4 && sq.length <= 8 };   // US and anything else
  }

  // ═════════ PLATE READING ═════════
  // Every region (state / emirate / province / municipality) has one or more PLATE SPECS: the plate is a sequence of parts, each
  // either letters (L), digits (D) or either (A), with a min–max length, or a fixed literal (like the state code on an Indian
  // plate). Reading a plate is then:
  //   1. find every glyph in the picture (adaptive threshold, both dark-on-light and light-on-dark text, ignoring frames, bolts,
  //      logos and stickers by shape);
  //   2. group glyphs by height — the plate's number is its biggest text; the emirate name, Arabic, month stickers and slogans
  //      are smaller — and try each group (and the two biggest together) as the candidate "plate text";
  //   3. read each glyph twice, once allowed only letters and once only digits, so 0/O, 1/I, 5/S, 8/B can't be confused;
  //   4. fit the glyph sequence to each spec for the chosen region (using the gap between code and number as a hint), picking the
  //      class (letter or digit) the spec demands at each position, and keep the best fit.
  // Nothing is accepted blindly: the result is always shown for the user to confirm.
  var L = function (min, max, id) { return { cls: 'L', min: min, max: max, id: id }; }, Dg = function (min, max, id) { return { cls: 'D', min: min, max: max, id: id }; }, Any = function (min, max, id) { return { cls: 'A', min: min, max: max, id: id }; }, Lit = function (txt, id) { return { lit: txt, min: txt.length, max: txt.length, id: id }; };
  var SPECS = {
    IN: function (r) { return r === 'BH' ? [{ label: 'BH series', parts: [Dg(2, 2, 'year'), Lit('BH', 'bh'), Dg(4, 4, 'num'), L(1, 2, 'ser')] }] : [{ label: 'Standard', parts: [Lit(r, 'state'), Dg(1, 2, 'dist'), L(0, 3, 'ser'), Dg(1, 4, 'num')] }]; },
    AE: function (r) {
      var codeD = [Dg(1, 2, 'code'), Dg(1, 5, 'num')], codeL = [L(1, 2, 'code'), Dg(1, 5, 'num')];
      var names = { DXB: 'Dubai', AUH: 'Abu Dhabi', SHJ: 'Sharjah', AJM: 'Ajman', UAQ: 'Umm Al Quwain', RAK: 'Ras Al Khaimah', FUJ: 'Fujairah' }, nm = names[r] || 'UAE';
      if (r === 'AUH') return [{ label: nm + ' · number code', parts: codeD, sep: true }];
      if (r === 'SHJ') return [{ label: nm + ' · 1 digit + number', parts: [Dg(1, 1, 'code'), Dg(1, 5, 'num')], sep: true }];
      if (r === 'DXB') return [{ label: nm + ' · letter code', parts: codeL, sep: true }, { label: nm + ' · number code (motorcycle)', parts: codeD, sep: true }];
      return [{ label: nm + ' · letter code', parts: codeL, sep: true }, { label: nm + ' · number code', parts: codeD, sep: true }];
    },
    QA: function () { return [{ label: 'Qatar', parts: [Dg(2, 6, 'num')] }]; },
    PK: function () { return [{ label: 'Standard', parts: [L(2, 3, 'pre'), Dg(3, 4, 'num')] }, { label: 'With year', parts: [L(2, 3, 'pre'), Dg(2, 2, 'yr'), Dg(3, 4, 'num')] }]; },
    US: function (r) { var o = []; if (r === 'CA') o.push({ label: 'California · 1ABC234', parts: [Dg(1, 1, 'a'), L(3, 3, 'b'), Dg(3, 3, 'c')] }); if (['NY', 'TX', 'PA', 'OH', 'GA', 'WA', 'MI'].indexOf(r) >= 0) o.push({ label: '3 letters + 4 digits', parts: [L(3, 3, 'pre'), Dg(4, 4, 'num')] }); o.push({ label: 'Standard (letters and digits)', parts: [Any(5, 8, 'num')] }); return o; }
  };
  var specsFor = function (country, region) { return (SPECS[country] || function () { return [{ label: 'Standard', parts: [Any(4, 9, 'num')] }]; })(region); };

  // ---- 1. glyphs ----
  function adaptive(gray, w, h, bright, frac) {   // local-mean threshold via an integral image: copes with shadows and glare
    var win = Math.max(15, Math.round(Math.min(w, h) * (frac || 0.9))) | 1, half = win >> 1, I = new Float64Array((w + 1) * (h + 1)), x, y, ink = new Uint8Array(w * h);
    for (y = 0; y < h; y++) { var row = 0; for (x = 0; x < w; x++) { row += gray[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    for (y = 0; y < h; y++) { var y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1); for (x = 0; x < w; x++) { var x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1), area = (x1 - x0) * (y1 - y0), sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0], mean = sum / area, v = gray[y * w + x]; ink[y * w + x] = bright ? (v > mean + 18 ? 1 : 0) : (v < mean - 18 ? 1 : 0); } }
    return ink;
  }
  function components(ink, w, h, pol) {
    var N = w * h, lab = new Int32Array(N), comps = [], stack = new Int32Array(N), id = 0, p;
    for (p = 0; p < N; p++) { if (!ink[p] || lab[p]) continue; id++; var sp = 0; stack[sp++] = p; lab[p] = id; var c = { id: id, pol: pol, x0: w, y0: h, x1: 0, y1: 0, area: 0 };
      while (sp) { var q = stack[--sp], cx = q % w, cy = (q / w) | 0; c.area++; if (cx < c.x0) c.x0 = cx; if (cx > c.x1) c.x1 = cx; if (cy < c.y0) c.y0 = cy; if (cy > c.y1) c.y1 = cy;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; var nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; var np = ny * w + nx; if (ink[np] && !lab[np]) { lab[np] = id; stack[sp++] = np; } } }
      c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1; comps.push(c); }
    return { lab: lab, comps: comps };
  }
  function otsu(g) { var h = new Array(256).fill(0), i, tot = g.length, sum = 0; for (i = 0; i < tot; i++) { h[g[i]]++; sum += g[i]; } var sB = 0, wB = 0, best = 0, th = 127; for (i = 0; i < 256; i++) { wB += h[i]; if (!wB) continue; var wF = tot - wB; if (!wF) break; sB += i * h[i]; var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = i; } } return th; }
  function globalInk(gray, N, bright) { var t = otsu(gray), ink = new Uint8Array(N), n = 0, i; for (i = 0; i < N; i++) { ink[i] = gray[i] < t ? 1 : 0; n += ink[i]; } var darkIsText = n <= N * 0.5; for (i = 0; i < N; i++) ink[i] = (bright ? !darkIsText : darkIsText) ? (gray[i] < t ? 1 : 0) : (gray[i] >= t ? 1 : 0); return ink; }
  function findGlyphs(canvas, box, mode) {   // mode: 'adaptive' (big + small window together, handles shadows) or 'otsu'
    var sw = canvas.width, sh = canvas.height, bx = Math.round(sw * box.x), by = Math.round(sh * box.y), bw = Math.max(16, Math.round(sw * box.w)), bh = Math.max(16, Math.round(sh * box.h));
    var sc = Math.min(1, 800 / Math.max(bw, bh)), w = Math.max(16, Math.round(bw * sc)), h = Math.max(16, Math.round(bh * sc)), c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, bx, by, bw, bh, 0, 0, w, h);
    var d = g.getImageData(0, 0, w, h).data, N = w * h, gray = new Uint8Array(N), i; for (i = 0; i < N; i++) gray[i] = (299 * d[i * 4] + 587 * d[i * 4 + 1] + 114 * d[i * 4 + 2]) / 1000;
    var out = { w: w, h: h, comps: [], labs: {}, gray: gray };
    var passes = mode === 'otsu' ? [['otsu', 0]] : mode === 'multi' ? [['adaptive', 0.9], ['local', 0.32]] : [['adaptive', 0.9]];
    passes.forEach(function (ps) { [false, true].forEach(function (bright) {
      var pol = ps[0] + (bright ? '_light' : '_dark'), cc = components(ps[0] === 'otsu' ? globalInk(gray, N, bright) : adaptive(gray, w, h, bright, ps[1]), w, h, pol); out.labs[pol] = cc.lab;
      cc.comps.forEach(function (o) {
        var fill = o.area / (o.w * o.h), asp = o.w / o.h;
        if (o.h < h * 0.07 || o.h > h * 0.95 || o.w > w * 0.4 || asp > 1.35) return;            // specks, frames, long rules, wide logos
        if (fill < 0.14 || (fill > 0.86 && asp > 0.55)) return;                                  // noise / solid boxes (a '1' is tall, so it passes)
        if (o.x0 <= 1 || o.y0 <= 1 || o.x1 >= w - 2 || o.y1 >= h - 2) { if (o.h > h * 0.5 || o.area < 30) return; }
        for (var q = 0; q < out.comps.length; q++) { var e = out.comps[q], ix = Math.min(e.x1, o.x1) - Math.max(e.x0, o.x0) + 1, iy = Math.min(e.y1, o.y1) - Math.max(e.y0, o.y0) + 1; if (ix > 0 && iy > 0 && ix * iy > 0.5 * Math.min(e.w * e.h, o.w * o.h)) return; }   // already found by another pass
        out.comps.push(o);
      });
    }); });
    return out;
  }
  // ---- 2. candidate glyph sets ----
  function candidateSets(gl) {
    var cs = mergeFragments(gl.comps).sort(function (a, b) { return b.h - a.h; }); if (cs.length < 1) return [];
    var clusters = []; cs.forEach(function (o) { var cl = clusters[clusters.length - 1]; if (cl && o.h >= cl.hmax * 0.74) { cl.items.push(o); cl.hmin = Math.min(cl.hmin, o.h); } else clusters.push({ items: [o], hmax: o.h, hmin: o.h }); });
    clusters = clusters.filter(function (c) { return c.items.length >= 1; });
    var sets = [];
    clusters.slice(0, 4).forEach(function (c, i) { if (c.items.length >= 2 || i === 0) sets.push(c.items); if (i > 0 && c.hmax >= clusters[0].hmax * 0.6 && c.items.length >= 1) sets.push(clusters[0].items.concat(c.items)); });
    // keep only glyphs that sit in one text band (vertical overlap with the group's median line), then order for reading
    return sets.filter(function (s) { return s.length >= 2; }).map(function (s) { if (s.length > 12) s = s.slice().sort(function (a, b) { return b.h - a.h; }).slice(0, 12); return readingOrder(s); });
  }
  // a glyph broken into pieces (a blurred 9, a bevelled 8) is merged back: pieces that sit on top of each other horizontally
  function mergeFragments(list) {
    var items = list.map(function (o) { return Object.assign({}, o, { parts: [{ pol: o.pol, id: o.id }] }); }), changed = true;
    while (changed) { changed = false; outer: for (var i = 0; i < items.length; i++) for (var j = i + 1; j < items.length; j++) { var a = items[i], b = items[j]; if (a.pol !== b.pol) continue;
        var ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1, narrow = Math.min(a.w, b.w), nh = Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0) + 1, tallest = Math.max(a.h, b.h);
        if (ov >= narrow * 0.6 && nh <= tallest * 1.9 && nh <= Math.max(a.h, b.h) * 1.9 && Math.min(a.h, b.h) < tallest * 0.9 && (Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) < tallest * 0.25)) {
          var m = { pol: a.pol, id: a.id, parts: a.parts.concat(b.parts), x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), area: a.area + b.area }; m.w = m.x1 - m.x0 + 1; m.h = m.y1 - m.y0 + 1; items.splice(j, 1); items[i] = m; changed = true; break outer; } } }
    return items;
  }
  function readingOrder(items) {   // rows top→bottom, each row left→right; a "row" is glyphs whose vertical centres are within half a glyph
    var ref = items.slice().sort(function (a, b) { return a.h - b.h; })[(items.length / 2) | 0].h, rows = [];
    items.slice().sort(function (a, b) { return (a.y0 + a.y1) - (b.y0 + b.y1); }).forEach(function (o) { var cy = (o.y0 + o.y1) / 2, r = rows.filter(function (r) { return Math.abs(r.cy - cy) < ref * 0.55; })[0]; if (r) { r.items.push(o); r.cy = r.items.reduce(function (a, b) { return a + (b.y0 + b.y1) / 2; }, 0) / r.items.length; } else rows.push({ cy: cy, items: [o] }); });
    var seq = []; rows.sort(function (a, b) { return a.cy - b.cy; }).forEach(function (r, ri) { r.items.sort(function (a, b) { return a.x0 - b.x0; }).forEach(function (o, k) { o._row = ri; seq.push(o); }); });
    return seq;
  }
  function gapsOf(seq) {   // normalised space between neighbours (neg = start of a new row)
    var ref = seq.slice().sort(function (a, b) { return a.h - b.h; })[(seq.length / 2) | 0].h, g = [];
    for (var i = 1; i < seq.length; i++) { var a = seq[i - 1], b = seq[i]; g.push((b.y0 > a.y1 - ref * 0.3 && b.x0 < a.x0 + ref * 0.5) ? 9 : (b.x0 - a.x1) / ref); }
    return g;
  }
  // ---- 3. read one glyph, twice ----
  function glyphCanvas(gl, o) {
    var pad = Math.max(3, Math.round(o.h * 0.22)), gw = o.w + pad * 2, gh = o.h + pad * 2, c = document.createElement('canvas'); c.width = gw; c.height = gh;
    var g = c.getContext('2d'), im = g.createImageData(gw, gh), dd = im.data, i, x, y; for (i = 0; i < dd.length; i += 4) { dd[i] = dd[i + 1] = dd[i + 2] = 255; dd[i + 3] = 255; }
    var parts = o.parts || [{ pol: o.pol, id: o.id }]; for (y = o.y0; y <= o.y1; y++) for (x = o.x0; x <= o.x1; x++) if (parts.some(function (pp) { return gl.labs[pp.pol][y * gl.w + x] === pp.id; })) { var k = ((y - o.y0 + pad) * gw + (x - o.x0 + pad)) * 4; dd[k] = dd[k + 1] = dd[k + 2] = 0; }
    g.putImageData(im, 0, 0); var sc = 72 / gh, out = document.createElement('canvas'); out.width = Math.max(8, Math.round(gw * sc)); out.height = 72; var og = out.getContext('2d'); og.imageSmoothingEnabled = true; og.fillStyle = '#fff'; og.fillRect(0, 0, out.width, 72); og.drawImage(c, 0, 0, out.width, 72); return out;
  }
  function grayGlyphCanvas(gl, o) {   // the glyph's own grey pixels (not the thresholded mask): keeps edges the mask loses on embossed plates
    var pad = Math.max(3, Math.round(o.h * 0.22)), x0 = Math.max(0, o.x0 - pad), y0 = Math.max(0, o.y0 - pad), x1 = Math.min(gl.w - 1, o.x1 + pad), y1 = Math.min(gl.h - 1, o.y1 + pad), gw = x1 - x0 + 1, gh = y1 - y0 + 1;
    var c = document.createElement('canvas'); c.width = gw; c.height = gh; var g = c.getContext('2d'), im = g.createImageData(gw, gh), dd = im.data, vals = [], x, y;
    for (y = 0; y < gh; y++) for (x = 0; x < gw; x++) vals.push(gl.gray[(y0 + y) * gl.w + x0 + x]);
    var sorted = vals.slice().sort(function (a, b) { return a - b; }), lo = sorted[(sorted.length * 0.03) | 0], hi = sorted[(sorted.length * 0.97) | 0], span = Math.max(30, hi - lo), inv = o.pol === 'light';
    for (var i = 0; i < vals.length; i++) { var v = Math.max(0, Math.min(255, (vals[i] - lo) * 255 / span)); if (inv) v = 255 - v; dd[i * 4] = dd[i * 4 + 1] = dd[i * 4 + 2] = v; dd[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0); var sc = 72 / gh, out = document.createElement('canvas'); out.width = Math.max(8, Math.round(gw * sc)); out.height = 72; var og = out.getContext('2d'); og.imageSmoothingEnabled = true; og.drawImage(c, 0, 0, out.width, 72); return out;
  }
  function readGlyph(gl, o) {
    if (o._r) return Promise.resolve(o._r);
    var cv = glyphCanvas(gl, o), tall = o.w / o.h < 0.3 && o.area / (o.w * o.h) > 0.7;      // a plain upright bar is a "1" (Dubai-style) or an "I"
    return getOcr().then(function (w) {
      function one(psm) { return w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: psm, user_defined_dpi: '300' }).then(function () { return w.recognize(cv); }).then(function (r) { var t = ((r.data.text || '').replace(/[^A-Za-z0-9]/g, '')[0] || '').toUpperCase(); return { t: t, c: t ? (r.data.confidence || 0) : 0 }; }); }
      return one('8').then(function (a) { if (a.t && a.c >= 70) return a; return one('13').then(function (b) { return b.c > a.c ? b : a; }); }).then(function (r) { if (tall && (!r.t || r.c < 85 || !/[0-9IL]/.test(r.t))) r = { t: '1', c: Math.max(r.c, 72) }; o._r = r; return r; });
    });
  }
  // read one ROW of glyphs as a line (the recogniser is far better with context than with isolated characters). Glyphs are
  // re-drawn alone on a clean white line, keeping their spacing; one symbol back per glyph is mapped 1:1.
  function rowCanvas(gl, row) {
    var x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0; row.forEach(function (o) { x0 = Math.min(x0, o.x0); y0 = Math.min(y0, o.y0); x1 = Math.max(x1, o.x1); y1 = Math.max(y1, o.y1); });
    var ref = row.slice().sort(function (a, b) { return a.h - b.h; })[(row.length / 2) | 0].h, pad = Math.round(ref * 0.3), gw = x1 - x0 + 1 + pad * 2, gh = y1 - y0 + 1 + pad * 2, c = document.createElement('canvas'); c.width = gw; c.height = gh;
    var g = c.getContext('2d'), im = g.createImageData(gw, gh), dd = im.data, i; for (i = 0; i < dd.length; i += 4) { dd[i] = dd[i + 1] = dd[i + 2] = 255; dd[i + 3] = 255; }
    row.forEach(function (o) { var parts = o.parts || [{ pol: o.pol, id: o.id }]; for (var y = o.y0; y <= o.y1; y++) for (var x = o.x0; x <= o.x1; x++) if (parts.some(function (pp) { return gl.labs[pp.pol][y * gl.w + x] === pp.id; })) { var k = ((y - y0 + pad) * gw + (x - x0 + pad)) * 4; dd[k] = dd[k + 1] = dd[k + 2] = 0; } });
    g.putImageData(im, 0, 0); var sc = Math.min(2, 90 / ref), out = document.createElement('canvas'); out.width = Math.round(gw * sc); out.height = Math.round(gh * sc); var og = out.getContext('2d'); og.imageSmoothingEnabled = true; og.drawImage(c, 0, 0, out.width, out.height); return out;
  }
  function readRows(gl, seq) {   // → array of {t,c} aligned with seq (null where the reader's symbol count doesn't match the glyph count)
    var rows = []; seq.forEach(function (o) { (rows[o._row || 0] = rows[o._row || 0] || []).push(o); });
    var out = [], p = Promise.resolve();
    function symbolsOf(r) {
      var syms = [];
      ((r.data && r.data.blocks) || []).forEach(function (b) { (b.paragraphs || []).forEach(function (pg) { (pg.lines || []).forEach(function (ln) { (ln.words || []).forEach(function (wd) { (wd.symbols || []).forEach(function (sy) { var t = (sy.text || '').replace(/[^A-Za-z0-9]/g, ''); if (t) syms.push({ t: t[0].toUpperCase(), c: sy.confidence || 0 }); }); }); }); }); });
      return syms;
    }
    rows.forEach(function (row) {
      p = p.then(function () {
        return getOcr().then(function (w) {
          return w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '7', user_defined_dpi: '300' }).then(function () { return w.recognize(rowCanvas(gl, row), {}, { blocks: true }); });
        }).then(function (r) {
          var syms = symbolsOf(r);
          if (syms.length === row.length) syms.forEach(function (sy) { out.push(sy); }); else row.forEach(function () { out.push(null); });
        });
      });
    });
    return p.then(function () { return out; });
  }
  // what a read character becomes when the template demands a digit or a letter (0/O, 1/I, 2/Z, 5/S, 8/B, 6/G, 4/A, 3/E)
  var LD = { O: '0', Q: '0', D: '0', I: '1', L: '1', T: '1', Z: '2', S: '5', B: '8', G: '6', A: '4', E: '3', U: '0', H: '4' }, DL = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '4': 'A', '3': 'E' };
  function classView(r, cls) {
    var t = r.t, dig = /\d/.test(t);
    if (cls === 'A') return { ch: t, cf: r.c };
    if (cls === 'D') return dig ? { ch: t, cf: r.c } : (LD[t] ? { ch: LD[t], cf: r.c * 0.35 - 20 } : { ch: '?', cf: -120 });
    return !dig ? { ch: t, cf: r.c } : (DL[t] ? { ch: DL[t], cf: r.c * 0.35 - 20 } : { ch: '?', cf: -120 });
  }
  // ---- 4. fit to a spec ----
  function fitSpec(seq, reads, gaps, spec) {
    var best = null;
    for (var dl = 0; dl <= 2; dl++) for (var dr = 0; dr <= 2; dr++) { if (seq.length - dl - dr < 2) continue; var f = fitSlice(seq.slice(dl, seq.length - dr), reads.slice(dl, reads.length - dr), gaps.slice(dl, Math.max(dl, gaps.length - dr)), spec); if (f) { f.score -= 14 * (dl + dr); if (!best || f.score > best.score) best = f; } }
    return best;
  }
  function fitSlice(seq, reads, gaps, spec) {
    var n = seq.length, parts = spec.parts, best = null;
    function cost(cls, k, lit, i) { var r = reads[i]; if (!r || !r.t) return -50; if (lit) { var m = classView(r, /\d/.test(lit[k]) ? 'D' : 'L'); return m.ch === lit[k] ? 60 : -40; } return classView(r, cls).cf; }
    (function rec(pi, pos, total, picks) {
      if (pi === parts.length) { if (pos !== n) return; var sc = total / n; if (spec.sep && parts.length >= 2) { var b = picks[0]; var gi = b - 1, gp = gi >= 0 && gi < gaps.length ? gaps[gi] : 0, med = gaps.slice().sort(function (a, c) { return a - c; })[(gaps.length / 2) | 0] || 0; sc += (gp > Math.max(0.45, med * 1.8)) ? 25 : -25; }
        if (!best || sc > best.score) best = { score: sc, picks: picks.slice(), spec: spec }; return; }
      var p = parts[pi]; for (var len = p.min; len <= p.max && pos + len <= n; len++) { var t = total, ok = true; for (var k = 0; k < len; k++) { t += cost(p.cls, k, p.lit, pos + k); } picks.push(pos + len); rec(pi + 1, pos + len, t, picks); picks.pop(); }
    })(0, 0, 0, []);
    if (!best) return null;
    var out = [], pos = 0; best.picks.forEach(function (end, pi) { var p = parts[pi], txt = ''; for (var i = pos; i < end; i++) { var r = reads[i]; txt += p.lit ? p.lit[i - pos] : (r && r.t ? classView(r, p.cls).ch : '?'); } out.push({ id: p.id, text: txt, lit: !!p.lit }); pos = end; });
    best.parts = out; return best;
  }
  function readPlateImage(canvas, boxes, ctx) {
    var country = ctx.country, region = ctx.region, specs = specsFor(country, region);
    function tryBox(i) {
      if (i >= boxes.length) return Promise.resolve(null);
      var order = ['adaptive', 'otsu', 'multi'], run = function (k, best) { if (k >= order.length || (best && best.score >= 95)) return Promise.resolve(best); return tryMode(i, order[k]).then(function (b) { return run(k + 1, (b && (!best || b.score > best.score)) ? b : best); }); };
      return run(0, null).then(function (best) { return best && best.score > 25 ? best : tryBox(i + 1).then(function (b2) { return b2 || best; }); });
    }
    function tryMode(i, mode) {
      var gl = findGlyphs(canvas, boxes[i], mode), sets = candidateSets(gl).slice(0, 4);
      if (!sets.length) return Promise.resolve(null);
      var chain = Promise.resolve(null);
      sets.forEach(function (seq) {
        chain = chain.then(function (best) {
          var reads = new Array(seq.length), p = readRows(gl, seq).then(function (rr) { rr.forEach(function (r, k) { reads[k] = r; }); }); seq.forEach(function (o, k) { p = p.then(function () { return reads[k] ? null : readGlyph(gl, o).then(function (r) { reads[k] = r; }); }).then(function () { if (reads[k] && /[0-9]/.test(reads[k].t) === false && (o.w / o.h < 0.3) && (o.area / (o.w * o.h) > 0.7) && reads[k].c < 85) reads[k] = { t: '1', c: 72 }; }); });
          return p.then(function () { var gaps = gapsOf(seq); specs.forEach(function (sp) { var f = fitSpec(seq, reads, gaps, sp); if (f && (!best || f.score > best.score)) best = f; }); return best; });
        });
      });
      return chain;
    }
    return tryBox(0).then(function (best) {
      if (!best) return null;
      var parts = best.parts, pick = function (id) { var p = parts.filter(function (x) { return x.id === id; })[0]; return p ? p.text : ''; };
      var all = parts.filter(function (p) { return !(p.lit && country === 'IN' && p.id === 'state'); }).map(function (p) { return p.text; });
      var res = { label: best.spec.label, score: best.score, parts: parts, region: region };
      if (country === 'IN') { res.state = region === 'BH' ? '' : region; res.bh = region === 'BH'; res.year = pick('year'); res.suffix = region === 'BH' ? pick('num') + ' ' + pick('ser') : [pick('dist'), pick('ser'), pick('num')].filter(Boolean).join(' '); res.full = region === 'BH' ? pick('year') + 'BH' + pick('num') + pick('ser') : region + [pick('dist'), pick('ser'), pick('num')].join(''); }
      else { res.suffix = all.join(' '); res.full = res.suffix; res.code = pick('code') || pick('pre') || ''; res.number = pick('num'); }
      res.ok = best.score > 40 && res.suffix.indexOf('?') < 0; return res;
    });
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
  // opens, or while the plate's state is being chosen — never at page load, and is shut down after 3 idle minutes to free memory.
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
  var VIN_WL = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789IOQ ', PLATE_WL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -';

  // ───────── camera dialog ─────────
  var CSS = '#gpsc{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:12px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff}' +
    '#gpsc .bx{width:100%;max-width:560px;background:#11181c;border:1px solid #2a343a;border-radius:16px;overflow:hidden}#gpsc .hd{padding:12px 16px;font-weight:700;display:flex;justify-content:space-between;align-items:center}' +
    '#gpsc .vw{position:relative;background:#000;aspect-ratio:4/3}#gpsc video{width:100%;height:100%;object-fit:cover;display:block}' +
    '#gpsc .gd{position:absolute;left:5%;right:5%;top:36%;height:28%;border:3px solid #7db0f5;border-radius:10px;box-shadow:0 0 0 999px rgba(0,0,0,.35)}' +
    '#gpsc .gd.pl{top:22%;height:56%}#gpsc .st{padding:10px 16px;min-height:44px;color:#b2bfc4}#gpsc .bt{display:flex;gap:8px;flex-wrap:wrap;padding:0 16px 16px}' +
    '#gpsc button,#gpsc .fb{font:600 14px system-ui,sans-serif;padding:10px 14px;border-radius:10px;border:1.5px solid #7db0f5;background:transparent;color:#fff;cursor:pointer}#gpsc button.pr{background:#7db0f5;color:#0b1d36}' +
    '#gpsc input[type=text],#gpsc select{width:100%;padding:11px;border-radius:10px;border:1px solid #3a464d;background:#192024;color:#fff;font:16px system-ui}#gpsc input[type=file]{display:none}' +
    '#gpsc .rs{padding:4px 16px 8px}#gpsc .ok{color:#52c7a0}#gpsc .wn{color:#f0b35a}#gpsc button:focus-visible,#gpsc input:focus-visible,#gpsc select:focus-visible{outline:3px solid #fff;outline-offset:2px}';
  function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in (attrs || {})) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // kind: 'vin' | 'plate'. Resolves with the confirmed raw text + how it was read, or null if cancelled.
  function cameraDialog(kind, title, hint, ctx) {
    return new Promise(function (resolve) {
      var root = el('div', { id: 'gpsc', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }), stream = null, reader = null, ctl = null, timer = null, busy = false, done = false, ocrReady = false, torchOn = false;
      var style = el('style'); style.textContent = CSS; root.appendChild(style);
      var box = el('div', { 'class': 'bx' }); root.appendChild(box);
      box.innerHTML = '<div class="hd"><span>' + esc(title) + '</span><button type="button" id="gpX" aria-label="Close">✕</button></div><div class="vw"><video playsinline muted autoplay></video><div class="gd' + (kind === 'plate' ? ' pl' : '') + '"></div></div><div class="st" id="gpSt" aria-live="polite"></div><div class="rs" id="gpRs"></div><div class="bt"><button type="button" class="pr" id="gpGo">Read now</button><label class="fb">📷 Use a photo<input type="file" accept="image/*" capture="environment" id="gpFile"></label><button type="button" id="gpTorch" style="display:none">🔦 Light</button><button type="button" id="gpType">Type it instead</button></div>';
      document.body.appendChild(root);
      var video = box.querySelector('video'), st = box.querySelector('#gpSt'), rs = box.querySelector('#gpRs');
      function status(t, cls) { st.className = 'st ' + (cls || ''); st.textContent = t; }
      function finish(v) { if (done) return; done = true; clearInterval(timer); try { ctl && ctl.stop && ctl.stop(); } catch (e) {} try { reader && reader.reset && reader.reset(); } catch (e) {} try { stream && stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} try { video.srcObject = null; } catch (e) {} root.remove(); resolve(v); }
      box.querySelector('#gpX').onclick = box.querySelector('#gpType').onclick = function () { finish(null); };
      root.addEventListener('keydown', function (e) { if (e.key === 'Escape') finish(null); });
      function accept(text, how, verified, plateRes) { if (done) return; clearInterval(timer); try { ctl && ctl.stop && ctl.stop(); } catch (e) {} showConfirm(text, how, verified, plateRes); }
      // confirmation card (editable)
      function showConfirm(text, how, verified, plateRes) {
        var reading = kind === 'vin';
        rs.innerHTML = '<label style="display:block;font-weight:600;margin:6px 0 4px">' + (reading ? 'VIN read' : 'Plate read') + ' — check it, fix it if needed</label><input type="text" id="gpTx" value="' + esc(text) + '" maxlength="' + (reading ? 17 : 14) + '" style="text-transform:uppercase;letter-spacing:.06em;font-family:ui-monospace,Menlo,monospace" autocomplete="off" autocapitalize="characters" spellcheck="false">' +
          '<div id="gpHint" class="' + (verified ? 'ok' : 'wn') + '" style="margin-top:6px">' + (reading ? (verified ? '✓ Valid VIN (check digit matches)' : 'Could not verify this VIN automatically — please compare it with the car.') : (plateRes ? esc(plateRes.label) + ' — ' + plateRes.parts.filter(function (x) { return !x.lit; }).map(function (x) { return esc(x.id === 'code' || x.id === 'pre' || x.id === 'state' ? 'code' : x.id === 'num' ? 'number' : x.id) + ' ' + esc(x.text); }).join(' · ') + (verified ? '' : '<br>Not sure about this one — please check each character against the plate.') : 'Plate text is read from the picture and can be wrong — please check it.')) + '</div>';
        box.querySelector('.bt').innerHTML = '<button type="button" class="pr" id="gpUse">Use this</button><button type="button" id="gpAgain">Scan again</button>';
        status(how === 'barcode' ? 'Barcode read.' : 'Text read.', 'ok');
        var tx = box.querySelector('#gpTx'); tx.focus(); tx.select();
        if (reading) tx.oninput = function () { var v = fixVinChars(tx.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); var h = box.querySelector('#gpHint'); if (v.length === 17) { var ok = VIN_OK.test(v) && checkDigitOk(v); h.className = ok ? 'ok' : 'wn'; h.textContent = ok ? '✓ Valid VIN (check digit matches)' : 'Check digit does not match — VINs made outside North America often do not use it, so compare with the car.'; } else { h.className = 'wn'; h.textContent = v.length + ' of 17 characters'; } };
        box.querySelector('#gpUse').onclick = function () { var v = tx.value.toUpperCase().trim(); if (reading) { v = fixVinChars(v.replace(/[^A-Z0-9]/g, '')); if (!VIN_OK.test(v)) { var h = box.querySelector('#gpHint'); h.className = 'wn'; h.textContent = 'A VIN has exactly 17 letters and digits (no I, O or Q).'; return; } } finish({ text: v, how: how, verified: reading ? checkDigitOk(v) : false, plate: (!reading && plateRes && v === text) ? plateRes : null }); };
        box.querySelector('#gpAgain').onclick = function () { finish({ again: true }); };
      }
      // handle a candidate string from either reader
      function consider(text, how) {
        if (kind === 'vin') { var f = extractVin(text); if (f && (how === 'barcode' || f.verified)) return accept(f.vin, how, f.verified); return f; }
        return null;
      }
      var lastGuess = null, lastPlate = null;
      function ocrFrame(canvas, full) {
        if (busy || done) return Promise.resolve();
        busy = true; status(ocrReady ? 'Reading text…' : 'Getting the text reader ready (first time only, a few MB)…');
        var box1 = full ? { x: 0, y: 0, w: 1, h: 1 } : { x: 0.05, y: 0.36, w: 0.9, h: 0.28 };
        if (kind === 'plate') { status('Reading the plate…'); return readPlateImage(canvas, full ? [{ x: 0, y: 0, w: 1, h: 1 }] : [{ x: 0.05, y: 0.22, w: 0.9, h: 0.56 }, { x: 0, y: 0, w: 1, h: 1 }], ctx || { country: 'IN', region: '' }).then(function (r) { busy = false; if (done) return; if (r && r.suffix) { if (full || (r.ok && r.score >= 85)) return accept(r.suffix, 'text', r.ok, r); lastPlate = r; status('Found something — hold steady, or press Read now to use it.', 'wn'); } else status(full ? 'No plate text found — try again, closer and level, or type it.' : 'Looking for the plate… fit it inside the box.'); }).catch(function (e) { busy = false; status('The plate reader could not start (' + (e && e.message || e) + '). You can type it instead.', 'wn'); }); }
        return Promise.resolve().then(function () { ocrReady = true; var pc = prep(canvas, box1); return kind === 'vin' ? ocrText(pc, 'sparse', VIN_WL).then(function (t) { var f = extractVin(t); if (!f) return ocrText(pc, 'block', VIN_WL).then(extractVin); return f; }) : ocrText(pc, 'line', PLATE_WL).then(function (t) { return squash(t).length >= 4 ? t : ocrText(pc, 'block', PLATE_WL); }); })
          .then(function (r) {
            busy = false; if (done) return;
            if (kind === 'vin') { if (r && r.verified) return accept(r.vin, 'text', true); if (r) { lastGuess = r; status('Found something that looks like a VIN but could not verify it. Hold steady, or press Read now to use it.', 'wn'); if (full) return accept(r.vin, 'text', false); } else status(full ? 'No VIN found in that photo — try again closer, or type it.' : 'Looking for a barcode or text…'); }
            else { if (r && r.suffix) { if (full || (r.ok && r.score >= 85)) return accept(r.suffix, 'text', r.ok, r); lastPlate = r; status('Found something — hold steady, or press Read now to use it.', 'wn'); } else status(full ? 'No plate text found — try again, closer and level, or type it.' : 'Looking for the plate… fit it inside the box.'); }
          }).catch(function (e) { busy = false; status('The text reader could not start (' + (e && e.message || e) + '). You can still scan barcodes or type it.', 'wn'); });
      }
      function snapshot() { var c = document.createElement('canvas'); c.width = video.videoWidth || 1280; c.height = video.videoHeight || 720; c.getContext('2d').drawImage(video, 0, 0, c.width, c.height); return c; }
      box.querySelector('#gpGo').onclick = function () { if (video.videoWidth) { if (kind === 'vin' && lastGuess && !busy) return accept(lastGuess.vin, 'text', lastGuess.verified); if (kind === 'plate' && lastPlate && !busy) return accept(lastPlate.suffix, 'text', lastPlate.ok, lastPlate); ocrFrame(snapshot(), false); } else status('The camera is not ready yet.'); };
      box.querySelector('#gpFile').onchange = function (e) {
        var f = e.target.files && e.target.files[0]; if (!f) return; status('Reading the photo…');
        var img = new Image(), url = URL.createObjectURL(f);
        img.onload = function () {
          var c = document.createElement('canvas'), sc = Math.min(1, 2200 / Math.max(img.width, img.height)); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          var pre = kind === 'vin' ? getZXing().then(function () { var rd = new ZXingBrowser.BrowserMultiFormatReader(hints()); return rd.decodeFromCanvas ? rd.decodeFromCanvas(c) : Promise.reject(); }).then(function (r) { return r && r.getText ? r.getText() : ''; }).catch(function () { return ''; }) : Promise.resolve('');
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
        status(kind === 'vin' ? 'Point at the VIN barcode or the printed VIN — it reads both. Hold steady.' : 'Fit the plate inside the box, then press Read now.');
        if (kind === 'vin') {
          getZXing().then(function () { reader = new ZXingBrowser.BrowserMultiFormatReader(hints()); return reader.decodeFromStream(s, video, function (res) { if (res && !done) consider(res.getText(), 'barcode'); }); }).then(function (c) { ctl = c; }).catch(function () {});
          // text reader: pre-load now, then look every ~2.5 s while no barcode has been found
          // barcodes need no text reader, so give them a head start; if nothing has scanned after ~1.2 s, start fetching it
          setTimeout(function () { if (!done) getOcr().then(function () { ocrReady = true; if (!busy && !done) status('Point at the VIN barcode or the printed VIN — it reads both. Hold steady.'); }).catch(function () {}); }, 1200);
          timer = setInterval(function () { if (!busy && !done && video.videoWidth && ocrReady) ocrFrame(snapshot(), false); }, 2500);
        } else { getOcr().then(function () { ocrReady = true; if (!busy && !done) status('Fit the plate inside the box — it reads automatically, or press Read now.'); }).catch(function () {}); timer = setInterval(function () { if (!busy && !done && video.videoWidth && ocrReady) ocrFrame(snapshot(), false); }, 2800); }
      }).catch(function (e) { status(e && e.name === 'NotAllowedError' ? 'Camera permission was refused. Allow it in the browser, or use “Use a photo”.' : 'Could not open the camera. Use “Use a photo”, or type it.', 'wn'); });
    });
  }
  function scanLoop(kind, title, hint, ctx) { return cameraDialog(kind, title, hint, ctx).then(function (r) { return r && r.again ? scanLoop(kind, title, hint, ctx) : r; }); }

  // ───────── public: VIN ─────────
  function scanVin() { return scanLoop('vin', 'Scan VIN', 'Starting the camera…').then(function (r) { return r ? { vin: r.text, how: r.how, verified: r.verified } : null; }); }

  // ───────── public: plate (region first) ─────────
  function pickRegion(opts) {
    return new Promise(function (resolve) {
      var regions = (opts.regions || []).slice(), root = el('div', { id: 'gpsc', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose the plate’s region' }), style = el('style'); style.textContent = CSS; root.appendChild(style);
      var label = opts.country === 'AE' ? 'emirate' : opts.country === 'PK' ? 'province' : opts.country === 'QA' ? 'municipality' : 'state';
      var optHtml = regions.map(function (r) { return '<option value="' + esc(r.plate) + '">' + esc(r.name) + ' (' + esc(r.plate) + ')</option>'; }).join('');
      if (opts.country === 'IN' && opts.allowBH !== false) optHtml += '<option value="BH">BH series (all-India plates)</option>';
      var box = el('div', { 'class': 'bx' }, '<div class="hd"><span>Scan the number plate</span><button type="button" id="gpX" aria-label="Close">✕</button></div><div class="rs"><label for="gpReg" style="display:block;font-weight:600;margin:8px 0">Which ' + label + ' is the plate from?</label><select id="gpReg"><option value="">Choose the ' + label + '…</option>' + optHtml + '</select><div style="margin-top:8px;color:#b2bfc4">Choosing first means the reader only has to get the rest of the plate right.</div></div><div class="bt"><button type="button" class="pr" id="gpGo" disabled>Open camera</button></div>');
      root.appendChild(box); document.body.appendChild(root);
      warmOcr(); var sel = box.querySelector('#gpReg'), go = box.querySelector('#gpGo'); sel.focus();
      sel.onchange = function () { go.disabled = !sel.value; };
      var close = function (v) { root.remove(); resolve(v); };
      box.querySelector('#gpX').onclick = function () { close(null); }; go.onclick = function () { close(sel.value); };
      root.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(null); });
    });
  }
  function scanPlate(opts) {
    opts = opts || {};
    return pickRegion(opts).then(function (region) {
      if (!region) return null;
      return scanLoop('plate', 'Scan plate · ' + region, 'Starting the camera…', { country: opts.country || 'IN', region: region }).then(function (r) {
        if (!r) return null; var pr = r.plate, p = pr ? { suffix: pr.suffix, full: pr.full, bh: pr.bh, year: pr.year, label: pr.label, ok: pr.ok } : (parsePlate(r.text, region, opts.country || 'IN') || { suffix: squash(r.text), full: squash(r.text) });
        return { region: region, plate: p.full, suffix: p.suffix, bh: !!p.bh, year: p.year, stateMismatch: !!p.stateMismatch, label: p.label || '', raw: r.text };
      });
    });
  }

  window.GPScan = { scanVin: scanVin, scanPlate: scanPlate, decodeVin: decodeVin, _t: { readPlateImage: readPlateImage, glyphCanvas: glyphCanvas, readRows: readRows, rowCanvas: rowCanvas, grayGlyphCanvas: grayGlyphCanvas, readGlyph: readGlyph, findGlyphs: findGlyphs, candidateSets: candidateSets, specsFor: specsFor, fitSpec: fitSpec, extractVin: extractVin, checkDigitOk: checkDigitOk, parsePlate: parsePlate, fixVinChars: fixVinChars, prep: prep, ocrText: ocrText, VIN_WL: VIN_WL, PLATE_WL: PLATE_WL } };
})();

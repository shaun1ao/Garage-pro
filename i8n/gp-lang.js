/*!
 * Garage Pro — language support, shared by EVERY page (site, app, booking, portal, tracking, docs, legal…)
 *
 *  1. A language picker (🌐) on every page. The choice is remembered in localStorage('gp_lang') and a cookie,
 *     so garagepro.me, /app, /book, /portal… all open in the same language.
 *  2. Whole-page translation into 11 Indian languages via Google's Website Translator (loaded only when a
 *     non-English language is chosen). In the workshop app this is opt-in with a notice, because translating
 *     sends the text on screen — customer names, vehicle numbers — to Google.
 *  3. gpT(key, lang, vars): hand-written translations for the messages customers actually receive
 *     (emails, WhatsApp texts, the booking page). These never go through Google. See messages-*.js.
 */
(function () {
  if (window.GP && window.GP.__ready) return;
  var LANGS = [
    ['en', 'English', 'English'], ['hi', 'Hindi', 'हिन्दी'], ['mr', 'Marathi', 'मराठी'], ['ta', 'Tamil', 'தமிழ்'],
    ['kn', 'Kannada', 'ಕನ್ನಡ'], ['te', 'Telugu', 'తెలుగు'], ['bn', 'Bengali', 'বাংলা'], ['gu', 'Gujarati', 'ગુજરાતી'],
    ['ml', 'Malayalam', 'മലയാളം'], ['pa', 'Punjabi', 'ਪੰਜਾਬੀ'], ['or', 'Odia', 'ଓଡ଼ିଆ'], ['ur', 'Urdu', 'اردو'], ['ar', 'Arabic', 'العربية']
  ];
  var ORDER = LANGS.map(function (l) { return l[0]; });
  var MSG = {};
  var GP = window.GP = { __ready: true, LANGS: LANGS, MSG: MSG };

  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else if (v !== undefined) localStorage.setItem(k, v); return localStorage.getItem(k); } catch (e) { return null; } }
  GP.code = function () { var c = store('gp_lang'); return ORDER.indexOf(c) >= 0 ? c : 'en'; };
  GP.info = function (c) { return LANGS.filter(function (l) { return l[0] === c; })[0] || LANGS[0]; };
  GP.valid = function (c) { return ORDER.indexOf(c) >= 0; };

  // ───────── hand-written message tables ─────────
  // GP.add({ 'key': [en, hi, mr, ta, kn, te, bn, gu, ml, pa, or, ur], … })   (same order as LANGS)
  GP.add = function (table) {
    Object.keys(table).forEach(function (k) {
      var row = table[k], o = {};
      for (var i = 0; i < ORDER.length; i++) if (row[i]) o[ORDER[i]] = row[i];
      MSG[k] = o;
    });
  };
  // GP.addLang('ar', { key: text, … }) — add one language's strings from a separate file (used for Arabic)
  GP.addLang = function (code, table) { Object.keys(table).forEach(function (k) { (MSG[k] = MSG[k] || {})[code] = table[k]; }); };
  // GP.t('greet', 'ta', { name: 'Arun' }) → translated text; falls back to English, then to the key.
  GP.t = function (key, lang, vars) {
    var row = MSG[key], s = row ? (row[lang] || row.en) : key;
    if (vars) s = String(s).replace(/\{(\w+)\}/g, function (m, n) { return vars[n] == null ? '' : vars[n]; });
    return s;
  };
  window.gpT = GP.t;

  // ───────── Google Website Translator (whole-page) ─────────
  function inApp() { return /\/app(\/|$)/.test(location.pathname) || !!document.getElementById('hdrLangBtn'); }
  function setCookie(n, v, days) {
    var base = n + '=' + v + ';path=/;max-age=' + (days * 86400);
    document.cookie = base;
    var host = location.hostname; if (host && host.indexOf('.') > 0 && !/^\d+\./.test(host)) document.cookie = base + ';domain=.' + host.replace(/^www\./, '');
  }
  function clearCookie(n) {
    document.cookie = n + '=;path=/;max-age=0';
    var host = location.hostname; if (host && host.indexOf('.') > 0) document.cookie = n + '=;path=/;max-age=0;domain=.' + host.replace(/^www\./, '');
  }
  function css() {
    if (document.getElementById('gp-lang-css')) return;
    var s = document.createElement('style'); s.id = 'gp-lang-css';
    s.textContent =
      '.goog-te-banner-frame,.goog-te-balloon-frame,#goog-gt-tt,.goog-tooltip,.goog-text-highlight{display:none!important;box-shadow:none!important;background:none!important}' +
      'body{top:0!important}.skiptranslate>iframe{display:none!important}#google_translate_element{position:absolute;left:-9999px;top:0;height:0;overflow:hidden}' +
      '#gpLangPill{position:fixed;left:14px;bottom:14px;z-index:2147483000;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}' +
      '#gpLangBtn{display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:100px;border:1px solid rgba(128,128,128,.35);background:rgba(20,24,32,.92);color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.28);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}' +
      '#gpLangMenu{position:absolute;left:0;bottom:46px;width:230px;max-height:60vh;overflow:auto;background:#fff;color:#16130e;border:1px solid #ddd;border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.28);padding:6px;display:none}' +
      '#gpLangMenu.open{display:block}#gpLangMenu button{display:flex;justify-content:space-between;width:100%;gap:10px;padding:9px 12px;border:0;background:none;border-radius:9px;cursor:pointer;font:500 14px system-ui,sans-serif;color:inherit;text-align:left}' +
      '#gpLangMenu button:hover{background:#f2efe8}#gpLangMenu button.on{background:#16130e;color:#fff}#gpLangMenu small{opacity:.55;font-size:11.5px}' +
      '#gpLangNote{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.6);display:grid;place-items:center;padding:20px}' +
      '#gpLangNote div{background:#fff;color:#16130e;max-width:440px;border-radius:16px;padding:22px;font:15px/1.55 system-ui,sans-serif}' +
      '#gpLangNote h3{margin:0 0 8px;font:800 18px system-ui,sans-serif}#gpLangNote .r{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}' +
      '#gpLangNote button{padding:10px 18px;border-radius:10px;border:1px solid #ccc;background:#fff;font:700 14px system-ui,sans-serif;cursor:pointer}#gpLangNote button.p{background:#ff7a18;border-color:#ff7a18;color:#170f05}' +
      '@media print{#gpLangPill{display:none}}';
    document.head.appendChild(s);
  }
  var loaded = false;
  function loadGoogle() {
    if (loaded) return; loaded = true; css();
    var host = document.getElementById('google_translate_element');
    if (!host) { host = document.createElement('div'); host.id = 'google_translate_element'; document.body.appendChild(host); }
    window.googleTranslateElementInit = function () {
      try {
        new google.translate.TranslateElement({ pageLanguage: 'en', includedLanguages: ORDER.filter(function (c) { return c !== 'en'; }).join(','), autoDisplay: false, layout: google.translate.TranslateElement.InlineLayout.SIMPLE }, 'google_translate_element');
      } catch (e) { console.warn('[gp-lang] translator init failed', e); }
    };
    var s = document.createElement('script'); s.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'; s.async = true;
    s.onerror = function () { console.warn('[gp-lang] could not load the translator'); };
    document.head.appendChild(s);
  }
  // Mark things that must never be translated (number plates, codes, brand name)
  function markNoTranslate() {
    try { document.querySelectorAll('.plate,code,.notranslate,[data-notranslate],.k-plate').forEach(function (el) { if (!el.hasAttribute('translate')) el.setAttribute('translate', 'no'); }); } catch (e) {}
  }

  GP.set = function (c, opts) {
    opts = opts || {};
    if (!GP.valid(c)) c = 'en';
    var prev = GP.code();
    if (c !== 'en' && inApp() && store('gp_lang_ok') !== '1' && !opts.consented) return askConsent(c);
    store('gp_lang', c); setCookie('gp_lang', c, 365);
    if (c === 'en') { clearCookie('googtrans'); } else { setCookie('googtrans', '/en/' + c, 365); }
    document.documentElement.setAttribute('lang', c);
    try { window.dispatchEvent(new CustomEvent('gp-lang', { detail: { lang: c, prev: prev } })); } catch (e) {}
    // Translating live needs the widget; switching back to English needs a clean reload (Google rewrote the DOM).
    var combo = document.querySelector('.goog-te-combo');
    if (c !== 'en' && combo) { combo.value = c; combo.dispatchEvent(new Event('change')); render(); return; }
    if (c === 'en' && prev === 'en') { render(); return; }
    if (opts.noReload) { if (c !== 'en') loadGoogle(); render(); return; }
    location.reload();
  };
  function askConsent(c) {
    if (document.getElementById('gpLangNote')) return;
    var d = document.createElement('div'); d.id = 'gpLangNote';
    d.innerHTML = '<div><h3>Translate the app?</h3>Translating sends the text on your screen — including customer names, vehicle numbers and amounts — to Google Translate. Nothing is stored by Garage Pro. You can switch back to English any time.<div class="r"><button type="button" id="gpLnNo">Not now</button><button type="button" class="p" id="gpLnYes">Translate to ' + GP.info(c)[2] + '</button></div></div>';
    document.body.appendChild(d);
    d.querySelector('#gpLnNo').onclick = function () { d.remove(); };
    d.querySelector('#gpLnYes').onclick = function () { store('gp_lang_ok', '1'); d.remove(); GP.set(c, { consented: true }); };
  }

  // ───────── the picker ─────────
  function render() {
    css();
    var pill = document.getElementById('gpLangPill');
    if (!pill) {
      pill = document.createElement('div'); pill.id = 'gpLangPill'; pill.className = 'notranslate'; pill.setAttribute('translate', 'no');
      pill.innerHTML = '<div id="gpLangMenu"></div><button id="gpLangBtn" type="button" aria-label="Choose language"></button>';
      document.body.appendChild(pill);
      pill.querySelector('#gpLangBtn').onclick = function (e) { e.stopPropagation(); pill.querySelector('#gpLangMenu').classList.toggle('open'); };
      document.addEventListener('click', function (e) { if (!pill.contains(e.target)) pill.querySelector('#gpLangMenu').classList.remove('open'); });
    }
    var cur = GP.code();
    // In the workshop app the header already has a language button — no floating pill there
    pill.querySelector('#gpLangBtn').style.display = inApp() ? 'none' : 'flex';
    pill.querySelector('#gpLangBtn').innerHTML = '<span aria-hidden="true">🌐</span><span>' + GP.info(cur)[2] + '</span>';
    pill.querySelector('#gpLangMenu').innerHTML = LANGS.map(function (l) { return '<button type="button" data-l="' + l[0] + '" class="' + (l[0] === cur ? 'on' : '') + '"><span>' + l[2] + '</span><small>' + l[1] + '</small></button>'; }).join('');
    pill.querySelectorAll('#gpLangMenu button').forEach(function (b) { b.onclick = function () { pill.querySelector('#gpLangMenu').classList.remove('open'); GP.set(b.dataset.l); }; });
  }
  GP.openPicker = function () {
    render(); var m = document.querySelector('#gpLangMenu'); if (!m) return;
    var hb = document.getElementById('hdrLangBtn'), pill = document.getElementById('gpLangPill');
    if (inApp() && hb) {                       // open the list right under the app's own header button
      var r = hb.getBoundingClientRect(); pill.style.cssText += ';left:' + Math.max(8, Math.min(r.left, window.innerWidth - 240)) + 'px;top:' + (r.bottom + 6) + 'px;bottom:auto';
      m.style.cssText += ';bottom:auto;top:0';
    }
    m.classList.toggle('open');
  };
  // The workshop app has its own header language button — route it to the picker
  window.gpToggleLang = function () { GP.openPicker(); };

  function boot() {
    document.documentElement.setAttribute('lang', GP.code());
    if (window.top === window.self) render();            // no second picker inside embedded frames (invoice previews etc.)
    markNoTranslate();
    new MutationObserver(function () { markNoTranslate(); }).observe(document.body, { childList: true, subtree: true });
    if (GP.code() !== 'en') {
      if (inApp() && store('gp_lang_ok') !== '1') { store('gp_lang', 'en'); clearCookie('googtrans'); render(); }   // never translate the app without consent
      else loadGoogle();
    } else clearCookie('googtrans');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

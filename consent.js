/* Garage Pro — cookie & privacy choices (no dependencies).
   • Only strictly necessary storage is used until the visitor says yes. Analytics is OFF by default.
   • "Reject" and "Accept" are the same size and colour; nothing is pre-ticked; choosing is never required to use the site.
   • A visitor's browser setting "Global Privacy Control" / "Do Not Track" is honoured as a "no" to analytics.
   • The choice can be changed or withdrawn at any time from "Cookie settings" (footer) — as easily as it was given.
   API: gpConsent.get('analytics') → boolean · gpConsent.open() · addEventListener('gp-consent', …) on window. */
(function () {
  'use strict';
  var KEY = 'gp_consent_v1', GA_ID = 'G-PS4YJ8GXWZ', gaLoaded = false;
  var gpc = (navigator.globalPrivacyControl === true) || (navigator.doNotTrack === '1');
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  var state = read();
  function allowed(k) { return k === 'necessary' ? true : !!(state && state[k]) && !gpc; }

  function loadGA() {
    if (gaLoaded || !allowed('analytics')) return; gaLoaded = true;
    window['ga-disable-' + GA_ID] = false;
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID; document.head.appendChild(s);
    window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
  }
  function unloadAnalytics() {
    window['ga-disable-' + GA_ID] = true;
    try { document.cookie.split(';').forEach(function (c) { var n = c.split('=')[0].trim(); if (/^_ga/.test(n)) { document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.' + location.hostname.replace(/^www\./, ''); document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; } }); } catch (e) {}
    try { localStorage.removeItem('gp_vid'); sessionStorage.removeItem('gp_sid'); sessionStorage.removeItem('gp_geo'); } catch (e) {}
  }
  function apply() {
    if (allowed('analytics')) loadGA(); else if (gaLoaded || read()) unloadAnalytics();
    try { window.dispatchEvent(new CustomEvent('gp-consent', { detail: { analytics: allowed('analytics') } })); } catch (e) {}
  }
  function save(analytics) { state = { v: 1, analytics: !!analytics, at: new Date().toISOString() }; write(state); close(); apply(); }

  var css = '#gpc{position:fixed;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;z-index:2147483000;background:#fff;color:#1b2a31;border:1px solid #c4cdd2;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:18px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '@media (prefers-color-scheme:dark){#gpc{background:#192024;color:#e6edef;border-color:#3a464d}}' +
    '#gpc h2{font-size:16px;margin:0 0 6px}#gpc p{margin:0 0 10px;opacity:.9}#gpc a{color:inherit;text-decoration:underline}' +
    '#gpc .r{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}#gpc button{flex:1;min-width:130px;font:600 14px system-ui,sans-serif;padding:11px 14px;border-radius:10px;border:1.5px solid currentColor;background:transparent;color:inherit;cursor:pointer}' +
    '#gpc button:focus-visible,#gpc input:focus-visible{outline:3px solid #2563b8;outline-offset:2px}#gpc label{display:flex;gap:10px;align-items:flex-start;margin:10px 0;cursor:pointer}#gpc input{width:18px;height:18px;margin-top:2px;flex:none}' +
    '#gpc small{display:block;opacity:.75}';
  var el = null;
  function close() { if (el) { el.remove(); el = null; } }
  function open(panel) {
    if (el) return; var st = document.createElement('style'); st.textContent = css; el = document.createElement('div'); el.id = 'gpc'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-labelledby', 'gpct'); el.appendChild(st);
    var box = document.createElement('div'); el.appendChild(box);
    function main() {
      box.innerHTML = '<h2 id="gpct">Your privacy choices</h2><p>We use only the cookies and storage the site needs to work. With your OK we would also use website analytics (Google Analytics, plus our own visit counter) to see which pages help people. It is off unless you turn it on, and you can change your mind any time. <a href="cookies.html">Cookie policy</a> · <a href="privacy.html">Privacy policy</a></p>' +
        (gpc ? '<p><b>Your browser sends a “do not track” signal, so analytics stays off.</b></p>' : '') +
        '<div class="r"><button type="button" id="gpcN">Reject analytics</button><button type="button" id="gpcY">Accept analytics</button><button type="button" id="gpcM">Choose</button></div>';
      box.querySelector('#gpcN').onclick = function () { save(false); }; box.querySelector('#gpcY').onclick = function () { save(true); }; box.querySelector('#gpcM').onclick = prefs;
    }
    function prefs() {
      box.innerHTML = '<h2 id="gpct">Cookie settings</h2><label><input type="checkbox" checked disabled> <span><b>Necessary</b> — sign-in, your language and theme, security. Always on, because the site can’t work without them.</span></label>' +
        '<label><input type="checkbox" id="gpcA" ' + (allowed('analytics') ? 'checked' : '') + (gpc ? ' disabled' : '') + '> <span><b>Analytics</b> — Google Analytics and our own visit counter: which pages are viewed, roughly where from, on what device. Off unless you tick it.<small>Google Analytics is set up with advertising features and Google signals switched off.</small></span></label>' +
        '<div class="r"><button type="button" id="gpcS">Save my choice</button></div>';
      box.querySelector('#gpcS').onclick = function () { save(box.querySelector('#gpcA').checked); };
    }
    (panel === 'prefs' ? prefs : main)(); document.body.appendChild(el); var f = el.querySelector('button'); if (f) f.focus();
  }
  window.gpConsent = { get: allowed, open: function () { close(); open('prefs'); }, reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} state = null; unloadAnalytics(); } };
  document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-cookie-settings]'); if (t) { e.preventDefault(); window.gpConsent.open(); } });
  function init() { if (allowed('analytics')) loadGA(); else window['ga-disable-' + GA_ID] = true; if (!state && !gpc) open(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

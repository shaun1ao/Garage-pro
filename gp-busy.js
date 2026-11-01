/*!
 * Garage Pro — loading spinner on any button that has to wait.
 * Click a button whose action is asynchronous (saving, sending, signing in, publishing…) and the button turns
 * into a spinner until the work finishes; it can't be double-clicked meanwhile. Quick actions (<150 ms) never flicker,
 * and the spinner steps aside while a confirm/prompt dialog is waiting for the user.
 * How: async functions called from a click (inline onclick="…", onsubmit, or el.onclick = async …) are wrapped so
 * the button that started them is shown busy until their promise settles. Load this LAST on a page.
 */
(function () {
  if (window.__gpBusy) return; window.__gpBusy = true;
  var css = document.createElement('style');
  css.textContent = '@keyframes gpspin{to{transform:rotate(360deg)}}' +
    '.gp-spin{display:inline-block;width:1.05em;height:1.05em;border:2.2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:gpspin .6s linear infinite;vertical-align:-.18em}' +
    '.gp-busy{pointer-events:none;cursor:progress}';
  document.head.appendChild(css);

  var current = null, dialogs = 0;
  var SEL = 'button, .btn, .mini-btn, .fbtn, [role="button"], input[type="submit"], a.cta';
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (b && b.dataset && b.dataset.gpBusy) { e.stopImmediatePropagation(); e.preventDefault(); return; }   // already working
    current = b; setTimeout(function () { current = null; }, 0);
  }, true);

  function busy(btn, promise) {
    if (!btn || !btn.isConnected || btn.tagName === 'INPUT') { return; }
    if (btn.dataset.gpBusy) { btn.dataset.gpBusy = String(Number(btn.dataset.gpBusy) + 1); }
    else {
      btn.dataset.gpBusy = '1';
      var orig = btn.innerHTML, w = btn.offsetWidth, h = btn.offsetHeight, prevMin = btn.style.minWidth, prevMinH = btn.style.minHeight;
      btn.__gpOrig = { html: orig, minW: prevMin, minH: prevMinH };
      btn.style.minWidth = w + 'px'; btn.style.minHeight = h + 'px';
      btn.classList.add('gp-busy');
      var shown = false, timer = setInterval(function () {
        if (!btn.dataset.gpBusy) return clearInterval(timer);
        var want = dialogs === 0;
        if (want && !shown) { btn.innerHTML = '<span class="gp-spin" aria-label="Working"></span>'; shown = true; }
        else if (!want && shown) { btn.innerHTML = orig; shown = false; }
      }, 120);
      btn.__gpTimer = timer;
    }
    var done = function () {
      var n = Number(btn.dataset.gpBusy || 0) - 1;
      if (n > 0) { btn.dataset.gpBusy = String(n); return; }
      delete btn.dataset.gpBusy; clearInterval(btn.__gpTimer); btn.classList.remove('gp-busy');
      var o = btn.__gpOrig || {};
      if (btn.querySelector && btn.querySelector('.gp-spin')) btn.innerHTML = o.html;      // put the label back (unless the handler already rewrote it)
      btn.style.minWidth = o.minW || ''; btn.style.minHeight = o.minH || '';
    };
    promise.then(done, done);
  }

  // 1) async functions that inline onclick="…"/onsubmit="…" call by name
  var isAsync = function (f) { return typeof f === 'function' && f.constructor && f.constructor.name === 'AsyncFunction'; };
  Object.getOwnPropertyNames(window).forEach(function (k) {
    var f; try { f = window[k]; } catch (_) { return; }
    if (!isAsync(f) || f.__gpWrapped) return;
    var d = Object.getOwnPropertyDescriptor(window, k); if (d && (d.get || d.writable === false)) return;
    var w = function () { var btn = current, p = f.apply(this, arguments); if (btn && p && typeof p.then === 'function') busy(btn, p); return p; };
    Object.keys(f).forEach(function (p) { w[p] = f[p]; });
    try { Object.defineProperty(w, 'name', { value: f.name }); } catch (_) {}
    w.__gpWrapped = true;
    try { window[k] = w; } catch (_) {}
  });

  // 2) el.onclick = async () => {…}
  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'onclick');
    if (desc && desc.set) Object.defineProperty(HTMLElement.prototype, 'onclick', {
      configurable: true, enumerable: desc.enumerable, get: desc.get,
      set: function (fn) {
        if (typeof fn !== 'function' || fn.__gpWrapped) return desc.set.call(this, fn);
        var w = function (ev) { var r = fn.call(this, ev); if (r && typeof r.then === 'function') busy(this, r); return r; };
        w.__gpWrapped = true; desc.set.call(this, w);
      }
    });
  } catch (_) {}

  // 3) a dialog waiting on the user is not "work" — hide the spinner while it is open
  ['customConfirm', 'customPrompt', 'customAlert'].forEach(function (k) {
    var f = window[k]; if (typeof f !== 'function') return;
    window[k] = function () { dialogs++; var p = f.apply(this, arguments); var d = function () { dialogs = Math.max(0, dialogs - 1); }; if (p && p.then) p.then(d, d); else d(); return p; };
  });
})();

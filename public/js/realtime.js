/**
 * Realtime client — listens for server nudges and refreshes the affected
 * part of the page without a full reload.
 *
 * How a page opts in:
 *   <body data-realtime="checklist:submitted,checklist:reviewed">
 * or set window.REALTIME_TOPICS = ['checklist:submitted'] before this loads.
 *
 * Transport strategy — deliberately belt-and-braces:
 *   1. Server-Sent Events for instant delivery where the browser cooperates.
 *   2. A slow poll that runs *permanently alongside* the stream as a safety
 *      net, so an update is never missed entirely.
 *
 * The second part matters because iOS Safari is unreliable with long-lived
 * connections: it throttles them, suspends them when the tab isn't frontmost,
 * and sometimes holds messages back. Rather than fight that, we accept a few
 * seconds' latency there and guarantee correctness.
 *
 * De-duplication is by event timestamp, so an event arriving via both
 * transports only triggers one refresh.
 */
console.log('[realtime] script loaded');

(function () {
  var SSE_POLL_MS = 10000;   // Safety-net poll while SSE looks healthy.
  var FALLBACK_POLL_MS = 5000; // Faster poll once we've given up on SSE.
  var SSE_PROVE_MS = 6000;   // Stream must greet us within this window.
  var RECONNECT_BASE_MS = 2000;
  var RECONNECT_MAX_MS = 20000;

  var reconnectDelay = RECONNECT_BASE_MS;
  var source = null;
  var refreshTimer = null;
  var pollTimer = null;
  var proveTimer = null;
  var isRefreshing = false;
  var sseHealthy = false;
  var gaveUpOnSse = false;
  var lastSeenStamp = 0;
  var debugEnabled = false;

  /* ── Optional on-screen status, for diagnosing on a phone ──────────
     Enable by adding ?rtdebug=1 to the URL, or localStorage.rtdebug = '1'. */
  function debugWanted() {
    // TEMPORARY: always on while we confirm realtime works on iOS.
    // Revert to the opt-in check below once verified.
    return true;
    /* eslint-disable no-unreachable */
    try {
      if (location.search.indexOf('rtdebug=1') !== -1) return true;
      return localStorage.getItem('rtdebug') === '1';
    } catch (e) { return false; }
  }

  function showDebug(msg) {
    try { console.log('[realtime] ' + msg); } catch (e) { /* ignore */ }
    if (!debugEnabled) return;
    var el = document.getElementById('rt-debug');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rt-debug';
      el.style.cssText = 'position:fixed;top:4px;right:4px;background:rgba(0,0,0,0.85);' +
        'color:#0f0;font-size:10px;padding:3px 7px;border-radius:4px;z-index:99999;' +
        'font-family:monospace;pointer-events:none;max-width:60vw;word-break:break-all;';
      document.body.appendChild(el);
    }
    el.textContent = 'RT: ' + msg;
  }

  function topicsForPage() {
    if (Array.isArray(window.REALTIME_TOPICS)) return window.REALTIME_TOPICS;
    var attr = document.body && document.body.getAttribute('data-realtime');
    if (!attr) return [];
    return attr
      .split(',')
      // Strip surrounding quotes defensively — a templating slip can leave
      // stray quote characters in the attribute value.
      .map(function (s) { return s.trim().replace(/^["']+|["']+$/g, ''); })
      .filter(Boolean);
  }

  debugEnabled = debugWanted();

  var topics = topicsForPage();
  if (topics.length === 0) {
    showDebug('inactive (no topics)');
    return; // This page doesn't want live updates.
  }

  /* ── Toast ────────────────────────────────────────────────────────── */

  function showToast(message) {
    var existing = document.getElementById('rt-toast');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.id = 'rt-toast';
    el.textContent = message;
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:1.25rem', 'transform:translateX(-50%)',
      'background:#1a1a2e', 'color:#fff', 'padding:0.6rem 1.1rem',
      'border-radius:999px', 'font-size:0.82rem', 'font-weight:600',
      'box-shadow:0 6px 24px rgba(0,0,0,0.25)', 'z-index:9999',
      'opacity:0', 'transition:opacity 0.2s', 'pointer-events:none',
      'font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif',
      'max-width:90vw', 'text-align:center'
    ].join(';');
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; });
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 250);
    }, 2200);
  }

  /* ── Partial page refresh ─────────────────────────────────────────── */

  var SWAP_SELECTORS = ['[data-live-region]', '.content', 'main'];

  function findSwapTarget(doc) {
    for (var i = 0; i < SWAP_SELECTORS.length; i++) {
      var sel = SWAP_SELECTORS[i];
      var current = document.querySelector(sel);
      var incoming = doc.querySelector(sel);
      if (current && incoming) return { current: current, incoming: incoming };
    }
    return null;
  }

  function refreshNow() {
    if (isRefreshing) return;

    // Don't yank the page out from under someone who's mid-edit.
    var active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
      scheduleRefresh(4000);
      return;
    }

    isRefreshing = true;
    var scrollY = window.scrollY;

    fetch(window.location.href, {
      headers: { 'X-Requested-With': 'realtime' },
      credentials: 'same-origin',
      cache: 'no-store'
    })
      .then(function (r) {
        if (!r.ok) throw new Error('bad status ' + r.status);
        return r.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var target = findSwapTarget(doc);
        if (!target) return;

        target.current.innerHTML = target.incoming.innerHTML;
        window.scrollTo(0, scrollY);

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          try { window.lucide.createIcons(); } catch (e) { /* non-fatal */ }
        }

        document.dispatchEvent(new CustomEvent('realtime:refreshed'));
      })
      .catch(function () { /* next event or poll will catch us up */ })
      .finally(function () { isRefreshing = false; });
  }

  function scheduleRefresh(delay) {
    clearTimeout(refreshTimer);
    // Debounce so a burst of events causes one refresh, not several.
    refreshTimer = setTimeout(refreshNow, delay || 400);
  }

  /** Returns true if this event was new and acted upon. */
  function handlePayload(payload) {
    if (!payload || !payload.topic) return false;
    if (topics.indexOf(payload.topic) === -1) return false;
    if (payload.at && payload.at <= lastSeenStamp) return false; // Already seen.
    if (payload.at) lastSeenStamp = payload.at;

    if (payload.data && payload.data.message) showToast(payload.data.message);
    scheduleRefresh();
    return true;
  }

  /* ── Transport A: Server-Sent Events ─────────────────────────────── */

  function startSse() {
    if (!window.EventSource || gaveUpOnSse) return;

    try {
      source = new EventSource('/events');
    } catch (e) {
      giveUpOnSse('constructor threw');
      return;
    }

    proveTimer = setTimeout(function () {
      if (!sseHealthy) giveUpOnSse('no greeting');
    }, SSE_PROVE_MS);

    source.addEventListener('ready', function () {
      clearTimeout(proveTimer);
      sseHealthy = true;
      reconnectDelay = RECONNECT_BASE_MS;
      showDebug('live (stream)');
    });

    source.addEventListener('update', function (e) {
      clearTimeout(proveTimer);
      sseHealthy = true;
      var payload;
      try { payload = JSON.parse(e.data); } catch (err) { return; }
      if (handlePayload(payload)) showDebug('update via stream');
    });

    source.onerror = function () {
      if (source && source.readyState === EventSource.CLOSED) {
        teardownSse();
        sseHealthy = false;
        showDebug('stream dropped, retrying');
        setTimeout(startSse, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
        if (reconnectDelay >= RECONNECT_MAX_MS) giveUpOnSse('kept dropping');
      }
    };
  }

  function teardownSse() {
    clearTimeout(proveTimer);
    if (source) {
      try { source.close(); } catch (e) { /* ignore */ }
      source = null;
    }
  }

  function giveUpOnSse(reason) {
    gaveUpOnSse = true;
    sseHealthy = false;
    teardownSse();
    showDebug('live (polling — ' + reason + ')');
    restartPoll();
  }

  /* ── Transport B: polling, always running as a safety net ────────── */

  function pollInterval() {
    return gaveUpOnSse ? FALLBACK_POLL_MS : SSE_POLL_MS;
  }

  function restartPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(pollOnce, pollInterval());
  }

  function pollOnce() {
    if (document.hidden) return;
    fetch('/events/since?after=' + lastSeenStamp, {
      credentials: 'same-origin',
      cache: 'no-store'
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.events)) return;
        var acted = false;
        data.events.forEach(function (ev) { if (handlePayload(ev)) acted = true; });
        if (acted) showDebug('update via poll');
      })
      .catch(function () { /* try again next tick */ });
  }

  /* ── Lifecycle ──────────────────────────────────────────────────── */

  function start() {
    showDebug('connecting');
    startSse();
    restartPoll();
    pollOnce(); // Immediate catch-up on load.
  }

  function stop() {
    teardownSse();
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function resume() {
    // iOS may have frozen or killed the stream while we were away.
    teardownSse();
    sseHealthy = false;
    if (!gaveUpOnSse) startSse();
    restartPoll();
    pollOnce();
    scheduleRefresh(300);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else resume();
  });

  // Safari restores pages from its back/forward cache without firing
  // visibilitychange, so catch that separately.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) resume();
  });

  // Coming back online after a dropout.
  window.addEventListener('online', resume);

  start();
})();

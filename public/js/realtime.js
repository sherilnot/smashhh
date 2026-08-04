/**
 * Realtime client — listens for server nudges and refreshes the affected
 * part of the page without a full reload.
 *
 * How a page opts in:
 *   <body data-realtime="checklist:submitted,checklist:reviewed">
 * or set window.REALTIME_TOPICS = ['checklist:submitted'] before this loads.
 *
 * Transport: Server-Sent Events where available, with an automatic fall back
 * to short polling. iOS Safari in particular can be unreliable with long-lived
 * streams (it suspends them aggressively and sometimes never delivers), so if
 * the stream doesn't prove itself quickly we quietly switch to polling. The
 * user-visible behaviour is the same either way.
 */
(function () {
  var POLL_MS = 12000;           // How often to poll when SSE isn't usable.
  var SSE_PROVE_MS = 6000;       // Stream must say hello within this window.
  var RECONNECT_BASE_MS = 2000;
  var RECONNECT_MAX_MS = 30000;

  var reconnectDelay = RECONNECT_BASE_MS;
  var source = null;
  var refreshTimer = null;
  var pollTimer = null;
  var proveTimer = null;
  var isRefreshing = false;
  var usingPolling = false;
  var lastSeenStamp = 0;

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

  var topics = topicsForPage();
  if (topics.length === 0) return; // This page doesn't want live updates.

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

  /** Which containers we try to swap, most specific first. */
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
        if (!target) return; // Nothing safe to swap — leave the page alone.

        target.current.innerHTML = target.incoming.innerHTML;
        window.scrollTo(0, scrollY);

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          try { window.lucide.createIcons(); } catch (e) { /* non-fatal */ }
        }

        document.dispatchEvent(new CustomEvent('realtime:refreshed'));
      })
      .catch(function () {
        /* Network hiccup — the next event or poll will catch us up. */
      })
      .finally(function () {
        isRefreshing = false;
      });
  }

  function scheduleRefresh(delay) {
    clearTimeout(refreshTimer);
    // Small debounce so a burst of events causes one refresh, not five.
    refreshTimer = setTimeout(refreshNow, delay || 400);
  }

  function handlePayload(payload) {
    if (!payload || !payload.topic) return;
    if (topics.indexOf(payload.topic) === -1) return;
    if (payload.at && payload.at <= lastSeenStamp) return; // Already handled.
    if (payload.at) lastSeenStamp = payload.at;

    if (payload.data && payload.data.message) showToast(payload.data.message);
    scheduleRefresh();
  }

  /* ── Transport A: Server-Sent Events ─────────────────────────────── */

  function startSse() {
    try {
      source = new EventSource('/events');
    } catch (e) {
      startPolling();
      return;
    }

    // If the stream doesn't greet us promptly, assume it won't work here
    // (iOS Safari sometimes opens the connection but delivers nothing).
    proveTimer = setTimeout(function () {
      if (!usingPolling) {
        teardownSse();
        startPolling();
      }
    }, SSE_PROVE_MS);

    source.addEventListener('ready', function () {
      clearTimeout(proveTimer);
      reconnectDelay = RECONNECT_BASE_MS;
    });

    source.addEventListener('update', function (e) {
      clearTimeout(proveTimer);
      var payload;
      try { payload = JSON.parse(e.data); } catch (err) { return; }
      handlePayload(payload);
    });

    source.onerror = function () {
      if (source && source.readyState === EventSource.CLOSED) {
        teardownSse();
        // Back off, then try again. If it keeps failing we land on polling.
        setTimeout(function () {
          if (!usingPolling) startSse();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
        if (reconnectDelay >= RECONNECT_MAX_MS) startPolling();
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

  /* ── Transport B: polling fallback ───────────────────────────────── */

  function startPolling() {
    if (usingPolling) return;
    usingPolling = true;
    teardownSse();

    clearInterval(pollTimer);
    pollTimer = setInterval(pollOnce, POLL_MS);
    pollOnce();
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
        data.events.forEach(handlePayload);
      })
      .catch(function () { /* try again next tick */ });
  }

  /* ── Lifecycle ──────────────────────────────────────────────────── */

  function start() {
    if (window.EventSource) startSse();
    else startPolling();
  }

  function stop() {
    teardownSse();
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // iOS suspends background tabs hard. Rebuild the transport on return and
  // catch up on anything missed while away.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stop();
    } else {
      usingPolling = false;
      start();
      scheduleRefresh(300);
    }
  });

  // Safari fires pageshow when restoring from its back/forward cache, where
  // visibilitychange alone isn't enough to notice we lost the connection.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      stop();
      usingPolling = false;
      start();
      scheduleRefresh(300);
    }
  });

  start();
})();

/**
 * Realtime client — listens for server nudges and refreshes the affected
 * part of the page without a full reload.
 *
 * How a page opts in:
 *   <body data-realtime="checklist:submitted,checklist:reviewed">
 * or set window.REALTIME_TOPICS = ['checklist:submitted'] before this loads.
 *
 * When a matching topic arrives we re-fetch the current URL, parse it, and
 * swap in the fresh <main>/.content markup. The user keeps their scroll
 * position and any open panels are re-applied where possible.
 */
(function () {
  if (!window.EventSource) return; // Very old browser — silently skip.

  var RECONNECT_BASE_MS = 2000;
  var RECONNECT_MAX_MS = 30000;
  var reconnectDelay = RECONNECT_BASE_MS;
  var source = null;
  var refreshTimer = null;
  var isRefreshing = false;

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
      'font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif'
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
      // Try again shortly — they may still be typing.
      scheduleRefresh(4000);
      return;
    }

    isRefreshing = true;
    var scrollY = window.scrollY;

    fetch(window.location.href, {
      headers: { 'X-Requested-With': 'realtime' },
      credentials: 'same-origin'
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

        // Re-run icon rendering if the theme uses Lucide.
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          try { window.lucide.createIcons(); } catch (e) { /* non-fatal */ }
        }

        document.dispatchEvent(new CustomEvent('realtime:refreshed'));
      })
      .catch(function () {
        /* Network hiccup — the next event or page load will catch us up. */
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

  function connect() {
    source = new EventSource('/events');

    source.addEventListener('ready', function () {
      reconnectDelay = RECONNECT_BASE_MS; // Healthy again.
    });

    source.addEventListener('update', function (e) {
      var payload;
      try { payload = JSON.parse(e.data); } catch (err) { return; }
      if (!payload || !payload.topic) return;
      if (topics.indexOf(payload.topic) === -1) return;

      if (payload.data && payload.data.message) showToast(payload.data.message);
      scheduleRefresh();
    });

    source.onerror = function () {
      // EventSource retries on its own, but if the server closed the stream
      // we back off and rebuild it to avoid hammering a struggling server.
      if (source.readyState === EventSource.CLOSED) {
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      }
    };
  }

  // Pause the stream while the tab is hidden to save battery and connections.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (source) { source.close(); source = null; }
    } else if (!source) {
      connect();
      scheduleRefresh(200); // Catch up on anything missed while away.
    }
  });

  connect();
})();

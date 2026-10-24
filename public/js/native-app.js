/**
 * Native App Enhancements (iOS app only)
 * Loaded on every page. In a normal browser it does nothing. Inside the
 * Capacitor iOS app it:
 *  - tags <html> with .native-app so theme.css can apply app-only styles
 *  - opens file downloads (PDF/CSV/ZIP) in the iOS share sheet, because the
 *    web view can't save "attachment" responses by itself
 *  - shows a loading bar as soon as a link or form is tapped
 *  - adds pull-to-refresh
 * Pages that start a download from script can call window.openDownload(url).
 */

(function () {
  var Capacitor = window.Capacitor;
  var isNative = !!(Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());

  window.openDownload = function (url) {
    if (!isNative) { window.location = url; return; }
    nativeDownload(url);
  };

  if (!isNative) return;

  document.documentElement.classList.add('native-app');

  var Plugins = Capacitor.Plugins || {};

  // ─── Downloads ──────────────────────────────────────────────────────────────

  var DOWNLOAD_PATH = /\/download\b|-export\b/;
  var downloading = false;

  function filenameFrom(res, url) {
    var header = res.headers.get('Content-Disposition') || '';
    var match = header.match(/filename="?([^";]+)"?/i);
    if (match) return match[1];
    return url.split('?')[0].split('/').pop() || 'download';
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function nativeDownload(url) {
    if (downloading) return;
    var Filesystem = Plugins.Filesystem;
    var Share = Plugins.Share;
    if (!Filesystem || !Share) { window.location = url; return; }

    downloading = true;
    document.documentElement.classList.add('native-busy');
    var filename;

    fetch(url, { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('Download failed (' + res.status + ')');
        filename = filenameFrom(res, url).replace(/[\/\\]/g, '_');
        return res.blob();
      })
      .then(blobToBase64)
      .then(function (data) {
        return Filesystem.writeFile({ path: filename, data: data, directory: 'CACHE' });
      })
      .then(function (result) {
        return Share.share({ title: filename, url: result.uri });
      })
      .catch(function (error) {
        // Closing the share sheet without picking anything also rejects
        if (/cancel/i.test(String(error && error.message))) return;
        console.error('[NativeApp] Download error:', error);
        alert('Could not open the file. Please try again.');
      })
      .then(function () {
        downloading = false;
        document.documentElement.classList.remove('native-busy');
      });
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href]');
    if (!link || link.origin !== window.location.origin) return;
    if (!DOWNLOAD_PATH.test(link.pathname)) return;
    e.preventDefault();
    nativeDownload(link.href);
  });

  // ─── Navigation feedback ────────────────────────────────────────────────────
  // Every tap loads a new page from the server, so show a loading bar right away
  // instead of leaving the old screen looking frozen.

  var navTimer;

  function startNavigating() {
    document.documentElement.classList.add('native-navigating');
    // Safety net for responses that don't replace the page (e.g. an unexpected download)
    clearTimeout(navTimer);
    navTimer = setTimeout(function () {
      document.documentElement.classList.remove('native-navigating');
    }, 10000);
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    var link = e.target.closest && e.target.closest('a[href]');
    if (!link || link.origin !== window.location.origin || link.target === '_blank' || link.hasAttribute('download')) return;
    if (link.getAttribute('href').charAt(0) === '#') return;
    if (link.pathname === window.location.pathname && link.search === window.location.search && link.hash) return;
    if (DOWNLOAD_PATH.test(link.pathname)) return;
    startNavigating();
  });

  document.addEventListener('submit', function (e) {
    if (!e.defaultPrevented) startNavigating();
  });

  // Coming back to a cached page (or a cancelled navigation) shouldn't keep the bar
  window.addEventListener('pageshow', function () {
    document.documentElement.classList.remove('native-navigating');
  });

  // ─── Pull to refresh ────────────────────────────────────────────────────────

  var THRESHOLD = 80;
  var startY = null;
  var pull = 0;
  var indicator;

  function ensureIndicator() {
    if (indicator) return indicator;
    indicator = document.createElement('div');
    indicator.className = 'ptr-indicator';
    indicator.innerHTML = '<span class="ptr-spinner"></span>';
    document.body.appendChild(indicator);
    return indicator;
  }

  // Don't hijack scrolling inside the open sidebar, modals or scrollable tables
  function inScrollableChild(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollTop > 0) return true;
      if (el.classList && el.classList.contains('sidebar')) return true;
    }
    return false;
  }

  document.addEventListener('touchstart', function (e) {
    if (window.scrollY > 0 || e.touches.length !== 1 || inScrollableChild(e.target)) { startY = null; return; }
    startY = e.touches[0].clientY;
    pull = 0;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (startY === null) return;
    pull = Math.max(0, e.touches[0].clientY - startY);
    if (pull <= 0) return;
    var el = ensureIndicator();
    var offset = Math.min(pull, THRESHOLD * 1.5) / 1.5;
    el.style.transform = 'translate(-50%, ' + offset + 'px)';
    el.style.opacity = Math.min(1, pull / THRESHOLD);
    el.classList.toggle('ready', pull >= THRESHOLD);
  }, { passive: true });

  document.addEventListener('touchend', function () {
    if (startY === null) return;
    startY = null;
    if (!indicator) return;
    if (pull >= THRESHOLD) {
      indicator.classList.add('refreshing');
      window.location.reload();
      return;
    }
    indicator.style.transform = '';
    indicator.style.opacity = 0;
    indicator.classList.remove('ready');
  });
})();

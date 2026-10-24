/**
 * Upload forms (cash reports, maintenance reports)
 * Forms marked <form data-upload> are sent from script instead of a normal
 * post so that:
 *  - photos are shrunk on the phone first (a 3–10 MB camera photo becomes a
 *    few hundred KB), which is most of the upload time on mobile data
 *  - the button shows real upload progress instead of a frozen screen
 * Videos are sent as they are. If anything here fails, the original file is
 * sent, so an upload never breaks because of this script.
 */

(function () {
  var MAX_SIDE = 2000;      // px, plenty to read cash notes and labels
  var JPEG_QUALITY = 0.8;

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      // <img> applies the photo's EXIF rotation, so the canvas copy is upright
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }

  function shrinkImage(file) {
    if (!/^image\/(jpeg|png|heic|heif|webp)$/i.test(file.type)) return Promise.resolve(file);
    return loadImage(file).then(function (img) {
      var scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) return resolve(file);
          var name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          resolve(new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified }));
        }, 'image/jpeg', JPEG_QUALITY);
      });
    }).catch(function () { return file; });
  }

  function buildFormData(form) {
    var data = new FormData(form);
    var entries = [];
    data.forEach(function (value, key) { entries.push([key, value]); });
    // Shrink one photo at a time to keep memory low on older phones
    return entries.reduce(function (chain, entry) {
      return chain.then(function (out) {
        var value = entry[1];
        if (!(value instanceof File) || !value.size) {
          if (!(value instanceof File)) out.append(entry[0], value);
          return out;
        }
        return shrinkImage(value).then(function (file) {
          out.append(entry[0], file, file.name);
          return out;
        });
      });
    }, Promise.resolve(new FormData()));
  }

  function formatMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (e.defaultPrevented || !form.hasAttribute || !form.hasAttribute('data-upload')) return;
    if (!window.FormData || !window.XMLHttpRequest) return; // fall back to a normal post
    e.preventDefault();

    var button = form.querySelector('button[type=submit]');
    var originalLabel = button ? button.innerHTML : '';
    var status = document.createElement('div');
    status.className = 'upload-status';
    status.innerHTML = '<div class="upload-status-text">Preparing photos…</div><div class="upload-bar"><span></span></div>';
    (button || form).insertAdjacentElement('afterend', status);
    var text = status.querySelector('.upload-status-text');
    var bar = status.querySelector('.upload-bar span');
    if (button) { button.disabled = true; button.textContent = 'Uploading…'; }

    function fail(message) {
      if (button) { button.disabled = false; button.innerHTML = originalLabel; }
      status.classList.add('upload-status-error');
      text.textContent = message;
      bar.parentNode.style.display = 'none';
    }

    buildFormData(form).then(function (data) {
      var xhr = new XMLHttpRequest();
      xhr.open((form.getAttribute('method') || 'POST').toUpperCase(), form.action);
      xhr.upload.onprogress = function (ev) {
        if (!ev.lengthComputable) return;
        var pct = Math.round((ev.loaded / ev.total) * 100);
        bar.style.width = pct + '%';
        text.textContent = pct < 100
          ? 'Uploading ' + pct + '% (' + formatMB(ev.loaded) + ' of ' + formatMB(ev.total) + ')'
          : 'Saving…';
      };
      xhr.onload = function () {
        if (xhr.status >= 400) return fail('Upload failed. A file may be too large (max 100 MB). Please try again.');
        text.textContent = 'Done';
        // The server redirects to the page with the result; show that page
        var next = xhr.responseURL || window.location.href;
        if (window.Turbo) window.Turbo.visit(next, { action: 'replace' });
        else window.location.replace(next);
      };
      xhr.onerror = function () { fail('Upload failed. Check your connection and try again.'); };
      xhr.send(data);
    });
  });
})();

// Menu-only release notice. No request or timer survives leaving the library.
var ReleaseUpdate = (function() {
  var endpoint = 'https://api.github.com/repos/samirmartins/vibelight-tizen/releases/latest';
  var key = 'vibelight.release-notice.v1', request = null, epoch = 0;
  var seenInSession = '', ownsDialog = false, priorStyle = null;

  function releaseDialog() {
    ownsDialog = false;
    var dialog = document.getElementById('warningDialog');
    if (dialog && priorStyle) {
      dialog.style.top = priorStyle.top;
      dialog.style.bottom = priorStyle.bottom;
      dialog.style.transform = priorStyle.transform;
      priorStyle = null;
    }
    var button = document.getElementById('closeWarning');
    if (button) button.removeEventListener('click', releaseDialog);
  }

  function version(value) {
    if (typeof value !== 'string' || !/^v?(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)) return null;
    return value.replace(/^v/, '').split('.').map(Number);
  }
  function newer(a, b) {
    for (var i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  }
  function cancel() {
    epoch++;
    if (request) {
      var old = request; request = null;
      old.onload = old.onerror = old.ontimeout = old.onprogress = null;
      try { old.abort(); } catch (e) {}
    }
    if (ownsDialog) {
      var dialog = document.getElementById('warningDialog');
      if (dialog && dialog.open) document.getElementById('closeWarning').click();
      releaseDialog();
    }
  }
  function check(canShow) {
    cancel();
    if (!canShow()) return;
    var installed = version(typeof appInfo !== 'undefined' && appInfo.version);
    if (!installed) return;
    var token = epoch, xhr;
    try {
      xhr = new XMLHttpRequest(); request = xhr;
      xhr.open('GET', endpoint, true);
      xhr.timeout = 5000;
      xhr.onprogress = function(e) { if (e.loaded > 262144) cancel(); };
      xhr.onerror = xhr.ontimeout = function() { if (request === xhr) request = null; };
      xhr.onload = function() {
        if (request !== xhr || token !== epoch) return;
        request = null;
        if (xhr.status !== 200 || !canShow() || xhr.responseText.length > 262144) return;
        var data;
        try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
        if (!data || data.draft !== false || data.prerelease !== false) return;
        var latest = version(data.tag_name);
        if (!latest || !newer(latest, installed)) return;
        var label = latest.join('.'), prior = null;
        try { prior = version(localStorage.getItem(key)); } catch (e) {}
        var session = version(seenInSession);
        if ((prior && !newer(latest, prior)) || (session && !newer(latest, session))) return;
        try {
          var dialog = document.getElementById('warningDialog');
          priorStyle = {top: dialog.style.top, bottom: dialog.style.bottom, transform: dialog.style.transform};
          dialog.style.top = '50%'; dialog.style.bottom = 'auto'; dialog.style.transform = 'translateY(-50%)';
          warningDialog('Update available', 'VibeLight ' + label + ' is available. Visit github.com/samirmartins/vibelight-tizen/releases to download it.');
        } catch (e) { releaseDialog(); return; }
        ownsDialog = true; seenInSession = label;
        document.getElementById('closeWarning').addEventListener('click', releaseDialog);
        try { localStorage.setItem(key, label); } catch (e) {}
      };
      xhr.send();
    } catch (e) { if (request === xhr) request = null; }
  }
  return { check: check, cancel: cancel };
})();

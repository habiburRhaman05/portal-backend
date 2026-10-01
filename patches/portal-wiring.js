/* Injected before the LAST </body>. Wraps the portal's own globals (saveForm, restoreForm,
   bdcapApplyState, confirm/change-request buttons); it does not rewrite them. */
(function () {
  var B = window.__BDCAP || {};
  var viewAs = B.viewAs;
  var SESSION = 'bdcap-session-v1';
  var STORE = 'bdcap-form-v1';
  var DRAFT_KEYS = [STORE, 'bdcap-draft-owner'];

  /* signed out: portal-pre.js is already redirecting to the login page, so do nothing else */
  var hasSession = false;
  try {
    var rawSession = localStorage.getItem(SESSION);
    hasSession = !!(rawSession && JSON.parse(rawSession).access_token);
  } catch (e) {}
  if (!hasSession) return;

  /* ── session + authenticated fetch ─────────────────────────── */
  function sessionEntry() {
    try {
      var raw = localStorage.getItem(SESSION);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data && data.access_token ? { key: SESSION, data: data } : null;
    } catch (e) {}
    return null;
  }
  function toLogin() {
    location.replace((B.loginUrl || '/login') + '?next=' + encodeURIComponent(location.pathname + location.search));
  }
  function nearExpiry(d) { return !!(d && d.expires_at && d.expires_at * 1000 - Date.now() < 60000); }

  /* The portal page is a separate document from the SPA, so nothing else refreshes the token
     while a client sits editing for an hour. Refresh through the backend. */
  var refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    var s = sessionEntry();
    if (!s || !s.data.refresh_token) return Promise.reject(new Error('no session'));
    refreshing = fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.data.refresh_token })
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('refresh failed')); })
      .then(function (n) {
        var cur = sessionEntry() || s;
        cur.data.access_token = n.access_token;
        cur.data.refresh_token = n.refresh_token;
        cur.data.expires_at = n.expires_at;
        cur.data.expires_in = n.expires_in;
        localStorage.setItem(cur.key, JSON.stringify(cur.data));
      })
      .then(function () { refreshing = null; }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }

  function api(path, opts, retried) {
    opts = opts || {};
    var s = sessionEntry();
    var ready = s && nearExpiry(s.data) ? refresh().catch(function () {}) : Promise.resolve();
    return ready.then(function () {
      var h = { 'Content-Type': 'application/json' };
      var cur = sessionEntry();
      if (cur && cur.data.access_token) h.Authorization = 'Bearer ' + cur.data.access_token;
      return fetch(path, Object.assign({}, opts, { headers: h }));
    }).then(function (res) {
      if (res.status !== 401) return res;
      if (retried) { toLogin(); return res; }
      return refresh().then(function () { return api(path, opts, true); }, function () { toLogin(); return res; });
    });
  }

  function readDraft() {
    try {
      var o = JSON.parse(localStorage.getItem(STORE) || 'null');
      return o ? { fields: o.fields || {}, sel: o.sel || {} } : null;
    } catch (e) { return null; }
  }

  /* ── debounced server save, wrapped around the portal's saveForm ── */
  var timer = null, saving = false, again = false, stopped = !!viewAs, lastSent = '';
  var originalSave = typeof window.saveForm === 'function' ? window.saveForm : null;

  function pushSave(keepalive) {
    if (stopped || document.body.classList.contains('locked')) return;
    if (saving) { again = true; return; }
    var body = readDraft();
    if (!body) return;
    var json = JSON.stringify(body);
    if (json === lastSent) return;
    saving = true;
    api('/api/portal/save', { method: 'POST', body: json, keepalive: !!keepalive })
      .then(function (res) {
        if (res.ok) lastSent = json;
        else if (res.status === 423) stopped = true;
      })
      .catch(function () {})
      .then(function () { saving = false; if (again) { again = false; schedule(); } });
  }
  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(function () { timer = null; pushSave(false); }, 2000);
  }

  if (originalSave) {
    window.saveForm = function () {
      if (viewAs) return;
      var r = originalSave.apply(this, arguments);
      if (!document.body.classList.contains('locked')) schedule();
      return r;
    };
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); timer = null; pushSave(true); }
  });

  /* ── Confirm submission: the server decides first, then the page locks ── */
  var go = document.getElementById('confirmGo');
  var allowSubmit = false, submitBusy = false;
  function submitFailed(status) {
    if (typeof window.closeConfirm === 'function') window.closeConfirm();
    var msg = status === 423 ? 'This portal is already locked.' : 'We could not submit right now. Your answers are saved here; please try again.';
    if (typeof window.showSubmitStatus === 'function') window.showSubmitStatus('<b>' + msg + '</b>');
  }
  if (go && !viewAs) {
    go.addEventListener('click', function (e) {
      if (allowSubmit) { allowSubmit = false; return; }
      e.stopImmediatePropagation();
      e.preventDefault();
      if (submitBusy) return;
      submitBusy = true;
      var label = go.textContent;
      go.disabled = true;
      go.textContent = 'Submitting…';
      clearTimeout(timer); timer = null;
      if (originalSave) originalSave();
      api('/api/portal/submit', { method: 'POST', body: JSON.stringify(readDraft() || { fields: {}, sel: {} }) })
        .then(function (res) {
          submitBusy = false; go.disabled = false; go.textContent = label;
          if (res.ok) { stopped = true; allowSubmit = true; go.click(); }
          else submitFailed(res.status);
        })
        .catch(function () { submitBusy = false; go.disabled = false; go.textContent = label; submitFailed(0); });
    }, true);
  }

  /* ── Change request: recorded on the server first ── */
  var send = document.getElementById('changeReqSend');
  var allowRequest = false, requestBusy = false;
  if (send && !viewAs) {
    send.addEventListener('click', function (e) {
      if (allowRequest) { allowRequest = false; return; }
      var t = document.getElementById('changeReqText'), p = document.getElementById('changeReqPart');
      if (!t || !t.value.trim()) return; /* the page shows its own "Tell us what needs to change." */
      e.stopImmediatePropagation();
      e.preventDefault();
      if (requestBusy) return;
      requestBusy = true; send.disabled = true;
      var fail = function () {
        requestBusy = false; send.disabled = false;
        var err = document.getElementById('changeReqError');
        if (err) { err.textContent = 'We could not send your request. Please try again.'; err.style.display = 'block'; }
      };
      api('/api/portal/change-request', {
        method: 'POST',
        body: JSON.stringify({ type: 'change_request', part: p ? p.value : 'website', text: t.value.trim() })
      }).then(function (res) {
        if (!res.ok) return fail();
        requestBusy = false; send.disabled = false; allowRequest = true; send.click();
      }).catch(fail);
    }, true);
  }

  /* ── Change-request status badges (pending / approved / rejected) + admin note ── */
  var listEl = document.getElementById('changeReqList');
  if (listEl) {
    var COLORS = {
      pending: ['#F5E6C8', '#8A6D1D'],
      approved: ['#D9EAD9', '#2D6B2D'],
      rejected: ['#F3D9D9', '#8A2D2D']
    };
    var decorate = function () {
      try {
        /* same array the page renders from, so indexes line up with the list items */
        var reqs = (window.sel && window.sel.changeRequests) || [];
        for (var i = 0; i < listEl.children.length; i++) {
          var item = listEl.children[i];
          if (item.querySelector('.statusBadge')) continue;
          var r = reqs[i] || {};
          var status = COLORS[r.status] ? r.status : 'pending';
          var badge = document.createElement('span');
          badge.className = 'statusBadge';
          badge.textContent = status.toUpperCase();
          badge.style.cssText = 'display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;letter-spacing:.04em;vertical-align:middle;background:' + COLORS[status][0] + ';color:' + COLORS[status][1] + ';';
          var when = item.querySelector('.when');
          (when || item).appendChild(badge);
          if (r.adminNote) {
            var note = document.createElement('div');
            note.className = 'statusNote';
            note.style.cssText = 'margin-top:4px;font-size:12px;opacity:.75;';
            note.textContent = 'Note from your manager: ' + r.adminNote;
            item.appendChild(note);
          }
        }
      } catch (e) {}
    };
    new MutationObserver(decorate).observe(listEl, { childList: true });
    decorate();
  }

  /* ── top bar: way back to the dashboard + sign out ── */
  function topBar() {
    var s = sessionEntry();
    var email = (s && s.data.user && s.data.user.email) || '';
    var bar = document.createElement('div');
    bar.style.cssText = 'position:sticky;top:0;z-index:9999;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 20px;background:#fff;border-bottom:1px solid #E5E2DD;font:13px system-ui,-apple-system,sans-serif;color:#1A1816;';
    var back = document.createElement('a');
    back.href = B.backUrl || '/dashboard';
    back.textContent = viewAs ? '← Back to client' : '← Dashboard';
    back.style.cssText = 'color:#3B6B4A;text-decoration:none;font-weight:600;';
    var right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:12px;color:#8C8478;';
    if (viewAs) {
      right.textContent = 'Admin view · read only';
    } else {
      var who = document.createElement('span'); who.textContent = email;
      var out = document.createElement('button'); out.type = 'button'; out.textContent = 'Sign out';
      out.style.cssText = 'background:none;border:1px solid #E5E2DD;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit;color:#1A1816;';
      out.addEventListener('click', function () {
        try {
          [SESSION].concat(DRAFT_KEYS).forEach(function (k) { localStorage.removeItem(k); });
        } catch (e) {}
        location.href = B.loginUrl || '/login';
      });
      right.appendChild(who); right.appendChild(out);
    }
    bar.appendChild(back); bar.appendChild(right);
    document.body.insertBefore(bar, document.body.firstChild);
  }
  topBar();

  /* ── prefill: the server copy replaces any local draft ── */
  function adminBanner(data) {
    var c = data.client || {};
    var html = 'Viewing <b>' + String(c.email || 'client').replace(/[<>&]/g, '') + '</b> as admin. Read only.';
    Array.prototype.forEach.call(document.querySelectorAll('.lockBanner'), function (b) { b.innerHTML = html; b.classList.add('on'); });
  }

  var url = viewAs ? '/api/admin/clients/' + encodeURIComponent(viewAs) + '/prefill' : '/api/portal/prefill';
  api(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (!data) return;
    var hasData = data.fields && Object.keys(data.fields).length > 0;
    if (hasData) {
      try { localStorage.setItem(STORE, JSON.stringify({ fields: data.fields, sel: data.sel || {} })); } catch (e) {}
      if (typeof window.restoreForm === 'function') window.restoreForm();
    }
    var d = readDraft();
    lastSent = d ? JSON.stringify(d) : '';

    if (typeof window.bdcapApplyState === 'function') {
      var st = data.status || {};
      if (viewAs) {
        window.bdcapApplyState({ completedOn: st.completedOn, lockedOn: st.lockedOn || new Date().toISOString() });
        adminBanner(data);
        try { localStorage.removeItem(STORE); } catch (e) {}
      } else {
        window.bdcapApplyState(st);
      }
    }
    /* anything scheduled by the page's own startup calls must not outlive a lock */
    if (document.body.classList.contains('locked')) { clearTimeout(timer); timer = null; }
  }).catch(function () {});
})();

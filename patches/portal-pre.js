/* Injected at the end of <head>, before the portal's own script runs.
   Runs on the dedicated frontend origin, where the SPA keeps the session in localStorage. */
(function () {
  var SESSION = 'bdcap-session-v1';
  var STORE = 'bdcap-form-v1';
  var OWNER = 'bdcap-draft-owner';

  function session() {
    try {
      var raw = localStorage.getItem(SESSION);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data && data.access_token ? { key: SESSION, data: data } : null;
    } catch (e) {}
    return null;
  }

  var viewAs = new URLSearchParams(location.search).get('viewAs');
  window.__BDCAP = {
    viewAs: viewAs,
    loginUrl: '/login',
    backUrl: viewAs ? '/admin/clients/' + encodeURIComponent(viewAs) : '/dashboard'
  };

  var s = session();
  if (!s || !s.data || !s.data.access_token) {
    location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
    return;
  }

  try {
    if (viewAs) {
      /* admin looking at a client: never read or keep a local draft */
      localStorage.removeItem(STORE);
    } else {
      /* a draft left by someone else on this browser must never appear for this user */
      var uid = s.data.user && s.data.user.id;
      if (uid && localStorage.getItem(OWNER) !== uid) {
        localStorage.removeItem(STORE);
        localStorage.setItem(OWNER, uid);
      }
    }
  } catch (e) {}

  if (viewAs) {
    var st = document.createElement('style');
    st.textContent = '#changeReqBtn{display:none!important}';
    document.head.appendChild(st);
  }
})();

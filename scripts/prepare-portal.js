#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Prefer the self-contained copy inside this repo (docs/handoff), so the
// repo can be deployed on its own without a sibling frontend-portal folder.
// Fall back to the sibling folder for local dev if that copy is newer/edited there.
const SELF_CONTAINED_SRC = path.join(__dirname, '..', 'docs', 'handoff', 'BDCap Client Portal.html');
const SIBLING_SRC = path.join(__dirname, '..', '..', 'frontend-portal', 'BDCap Client Portal.html');
const SRC = fs.existsSync(SELF_CONTAINED_SRC) ? SELF_CONTAINED_SRC : SIBLING_SRC;
const DEST = path.join(__dirname, '..', 'public', 'clients', 'portal', 'index.html');

if (!fs.existsSync(SRC)) {
  console.error('Source portal not found. Checked:');
  console.error('  ' + SELF_CONTAINED_SRC);
  console.error('  ' + SIBLING_SRC);
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
const originalHash = crypto.createHash('md5').update(html).digest('hex');

// ─── Remove protonav block ────────────────────────────────────────────
const protonav = /<div class="protonav">[\s\S]*?<\/div>\s*<\/div>/;
const protonavMatch = html.match(protonav);
if (protonavMatch) {
  html = html.replace(protonav, '<!-- protonav removed for production -->');
  console.log('[OK] Removed protonav block');
} else {
  console.log('[SKIP] No protonav block found');
}

// ─── Remove .protonav CSS rules ─────────────────────────────────────
const cssRules = [
  /\s*\.protonav\{[^}]*\}/g,
  /\s*\.protonav\s+\.wrap\{[^}]*\}/g,
  /\s*\.protonav\s+\.tag\{[^}]*\}/g,
  /\s*\.protonav\s+a\{[^}]*\}/g,
  /\s*\.protonav\s+a:hover\{[^}]*\}/g,
  /\s*\.protonav\s+a\.active\{[^}]*\}/g,
];

let cssRemoved = 0;
for (const rule of cssRules) {
  const before = html.length;
  html = html.replace(rule, '');
  if (html.length < before) cssRemoved++;
}
console.log(`[OK] Removed ${cssRemoved} .protonav CSS rules`);

// ─── Verify previewEngineSrc is untouched ───────────────────────────
const engineBlock = html.match(/<script id="previewEngineSrc"[^>]*>([\s\S]*?)<\/script>/);
if (engineBlock) {
  const engineHash = crypto.createHash('md5').update(engineBlock[1]).digest('hex');
  console.log(`[OK] previewEngineSrc intact (hash: ${engineHash})`);
} else {
  console.log('[WARN] previewEngineSrc block not found');
}

// ─── Apply wiring patch: add server POST to saveForm + prefill load ──
const wiringPatch = `
<script>
(function(){
  // ─── Debounced save to server ──────────────────────────────────
  var _saveTimer = null;
  var _saving = false;
  function serverSave(immediate){
    if(_saveTimer){ clearTimeout(_saveTimer); _saveTimer = null; }
    function doSave(){
      if(_saving) return;
      _saving = true;
      try{
        var store = localStorage.getItem('bdcap-form-v1');
        if(!store) return;
        var data = JSON.parse(store);
        fetch('/api/portal/save', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          credentials: 'same-origin',
          body: JSON.stringify({fields: data.fields || {}, sel: data.sel || {}})
        }).catch(function(){}).finally(function(){ _saving = false; });
      }catch(e){ _saving = false; }
    }
    if(immediate){ doSave(); }
    else { _saveTimer = setTimeout(doSave, 2000); }
  }

  // Hook into saveForm by intercepting localStorage.setItem
  var origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value){
    origSetItem.call(this, key, value);
    if(key === 'bdcap-form-v1'){ serverSave(false); }
  };

  // ─── Confirm submission: immediate save ────────────────────────
  var confirmGo = document.getElementById('confirmGo');
  if(confirmGo){
    confirmGo.addEventListener('click', function(){
      setTimeout(function(){ serverSave(true); }, 50);
    });
  }

  // ─── Submit button: immediate POST to /api/portal/submit ──────
  var origConfirmGo = confirmGo;
  if(origConfirmGo){
    var submitHandler = function(){
      setTimeout(function(){
        try{
          var store = localStorage.getItem('bdcap-form-v1');
          if(!store) return;
          var data = JSON.parse(store);
          fetch('/api/portal/submit', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            credentials: 'same-origin',
            body: JSON.stringify({fields: data.fields || {}, sel: data.sel || {}})
          }).catch(function(){});
        }catch(e){}
      }, 100);
    };
    origConfirmGo.addEventListener('click', submitHandler);
  }

  // ─── Change request: POST to server ────────────────────────────
  var changeReqSend = document.getElementById('changeReqSend');
  if(changeReqSend){
    changeReqSend.addEventListener('click', function(){
      setTimeout(function(){
        var t = document.getElementById('changeReqText');
        var p = document.getElementById('changeReqPart');
        if(!t || !t.value.trim()) return;
        fetch('/api/portal/change-request', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          credentials: 'same-origin',
          body: JSON.stringify({type: 'change_request', part: p ? p.value : 'website', text: t.value.trim(), at: new Date().toISOString()})
        }).catch(function(){});
      }, 50);
    });
  }

  // ─── Prefill from server on load ───────────────────────────────
  fetch('/api/portal/prefill', {credentials: 'same-origin'})
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      if(!data) return;
      // Server data overrides localStorage
      if(data.fields && Object.keys(data.fields).length){
        var store = {};
        try{ store = JSON.parse(localStorage.getItem('bdcap-form-v1') || '{}'); }catch(e){}
        store.fields = data.fields;
        if(data.sel) store.sel = data.sel;
        localStorage.setItem('bdcap-form-v1', JSON.stringify(store));
        // Re-run restoreForm if available
        if(typeof window.restoreForm === 'function') window.restoreForm();
        else location.reload();
      }
      // Apply lock state
      if(data.status && (data.status.lockedOn || data.status.changesUntil)){
        if(typeof window.bdcapApplyState === 'function') window.bdcapApplyState(data.status);
      }
    })
    .catch(function(){});

  // ─── Sign out clears localStorage ──────────────────────────────
  window.addEventListener('beforeunload', function(){});

  // ─── Status badge on each change request (pending / resolved) ──
  // The core portal script renders #changeReqList items but has no notion
  // of a status field; this watches the list and appends a badge based on
  // sel.changeRequests[i].status without touching the original renderer.
  var changeReqListEl = document.getElementById('changeReqList');
  if(changeReqListEl){
    var STATUS_STYLE = {
      pending:  {bg:'#F5E6C8', fg:'#8A6D1D'},
      resolved: {bg:'#D9EAD9', fg:'#2D6B2D'}
    };
    function addStatusBadges(){
      try{
        var store = JSON.parse(localStorage.getItem('bdcap-form-v1') || '{}');
        var reqs = (store.sel && store.sel.changeRequests) || [];
        var items = changeReqListEl.children;
        for(var i=0;i<items.length;i++){
          var item = items[i];
          if(item.querySelector('.statusBadge')) continue;
          var status = (reqs[i] && reqs[i].status) || 'pending';
          var style = STATUS_STYLE[status] || STATUS_STYLE.pending;
          var badge = document.createElement('span');
          badge.className = 'statusBadge';
          badge.textContent = status.toUpperCase();
          badge.style.cssText = 'display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;letter-spacing:0.04em;vertical-align:middle;background:' + style.bg + ';color:' + style.fg + ';';
          var whenEl = item.querySelector('.when');
          if(whenEl) whenEl.appendChild(badge); else item.appendChild(badge);
        }
      }catch(e){}
    }
    new MutationObserver(addStatusBadges).observe(changeReqListEl, {childList: true});
    addStatusBadges();
  }
})();
</script>`;

// Insert before closing </body>
html = html.replace('</body>', wiringPatch + '\n</body>');
console.log('[OK] Applied portal wiring (server save + prefill + submit + change request)');

// ─── Write output ─────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.writeFileSync(DEST, html, 'utf8');
const finalHash = crypto.createHash('md5').update(html).digest('hex');

console.log(`\nSource:  ${SRC} (${originalHash})`);
console.log(`Output:  ${DEST} (${finalHash})`);
console.log(`Changes: protonav removed, ${cssRemoved} CSS rules removed, wiring patch applied`);
console.log('Done.');

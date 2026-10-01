// Runs the real patched portal page in Chrome against a stub backend.
//   npm run test:browser          (needs Chrome/Chromium; set CHROME_PATH if it is not auto-detected)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) {
  console.log('SKIP browser tests: playwright-core is not installed (npm install).');
  process.exit(0);
}

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => p && fs.existsSync(p));
if (!CHROME) {
  console.log('SKIP browser tests: no Chrome found (set CHROME_PATH).');
  process.exit(0);
}

const PORTAL = path.join(os.tmpdir(), 'bdcap-portal-under-test.html');
execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'prepare-portal.js'), '--out', PORTAL], { stdio: 'pipe' });
const html = fs.readFileSync(PORTAL);

const FULL_FIELDS = {
  legalFirstName: 'Alice', legalLastName: 'Lee', dateOfBirth: '1990-01-02', personalEmail: 'alice@x.com',
  personalPhone: '5551112222', mailingStreet: '1 Main', mailingCity: 'Austin', mailingState: 'TX', mailingZip: '78701',
  bizNameInput: 'Lee Advisory', domainInput: 'leeadvisory.com', taglineInput: 'Structure first',
};
const SEL = { tier: 'basic', tpl: 'sidebar', fnt: 'Contemporary', pal: 'Oxblood', thm: 'NIL Consulting', nav0: 0, nav1: 3, nav2: 1, pg: 0, heroPg: ['', '', ''], variant: 2 };
const NOT_LOCKED = { completedOn: '', lockedOn: '', changesUntil: '' };

let state;
const resetState = () => {
  state = {
    calls: [],
    validTokens: new Set(['tok-1']),
    prefill: { fields: { ...FULL_FIELDS }, sel: { ...SEL, changeRequests: [] }, status: { ...NOT_LOCKED }, site: {} },
    adminPrefill: null,
    failPaths: new Set(),
  };
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const url = req.url.split('?')[0];
    const auth = (req.headers.authorization || '').replace('Bearer ', '');
    const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (url === '/portal/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html); }
    if (url === '/login') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<title>login</title>'); }
    if (url === '/api/auth/refresh') {
      state.calls.push({ url, body: JSON.parse(body || '{}') });
      state.validTokens.add('tok-2');
      return json(200, { access_token: 'tok-2', refresh_token: 'ref-2', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600 });
    }
    if (!url.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    state.calls.push({ url, method: req.method, auth, body: body ? JSON.parse(body) : null });
    if (!state.validTokens.has(auth)) return json(401, { error: 'SESSION_EXPIRED' });
    if (state.failPaths.has(url)) return json(500, { error: 'boom' });
    if (url === '/api/portal/prefill') return json(200, state.prefill);
    if (url.startsWith('/api/admin/clients/') && url.endsWith('/prefill')) return json(200, state.adminPrefill || state.prefill);
    if (url === '/api/portal/save') return json(200, { ok: true });
    if (url === '/api/portal/submit') return json(200, { ok: true, completedOn: new Date().toISOString(), lockedOn: new Date().toISOString() });
    if (url === '/api/portal/change-request') return json(200, { ok: true, request: { id: 'r1', status: 'pending' } });
    return json(404, { error: 'nope' });
  });
});

const session = (token = 'tok-1') => JSON.stringify({
  access_token: token, refresh_token: 'ref-1', expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'u-alice', email: 'alice@x.com' },
});

let passed = 0, failed = 0;
async function scenario(browser, name, opts, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  resetState();
  if (opts.setup) opts.setup();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route(/rdap\.verisign\.com|fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const initial = { session: opts.noSession ? null : session(opts.token), extra: opts.localStorage || {} };
  await ctx.addInitScript((init) => {
    // seed once per context so reloads behave like a real browser profile
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    if (init.session) localStorage.setItem('bdcap-session-v1', init.session);
    for (const [k, v] of Object.entries(init.extra)) localStorage.setItem(k, v);
  }, initial);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    const prefillSeen = opts.noSession ? null : page.waitForResponse(r => /prefill/.test(r.url()), { timeout: 15000 });
    await page.goto(`http://127.0.0.1:${server.address().port}/portal/index.html${opts.query || ''}`);
    if (!opts.noSession) {
      await prefillSeen;
      await page.waitForTimeout(600);
    } else {
      await page.waitForTimeout(800);
    }
    await fn(page);
    assert.deepStrictEqual(errors, [], 'page errors: ' + errors.join(' | '));
    console.log(`  [PASS] ${name}`); passed++;
  } catch (e) {
    console.error(`  [FAIL] ${name}: ${e.message.split('\n').slice(0, 5).join(' ').slice(0, 400)}`);
    if (process.env.DEBUG_CALLS) console.error('     calls:', JSON.stringify(state.calls.map(c => [c.url, c.method, c.body && c.body.fields ? Object.keys(c.body.fields).length : null])));
    failed++;
  } finally {
    await ctx.close();
    await new Promise(r => setTimeout(r, 700)); // let a flush-on-hide keepalive request land before the next scenario resets state
  }
}

const view = (page, v) => page.evaluate((n) => showView(n), v);
const val = (page, id) => page.evaluate((i) => document.getElementById(i).value, id);
const locked = (page) => page.evaluate(() => document.body.classList.contains('locked'));
const banner = (page) => page.evaluate(() => [...document.querySelectorAll('.lockBanner')].map(b => b.textContent).join(' | '));
const calls = (url) => state.calls.filter(c => c.url === url);
const iso = (ms) => new Date(Date.now() + ms).toISOString();

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log('\n=== Portal browser tests (patched page, stub backend) ===\n');

  await scenario(browser, 'server data replaces the form and design; nothing is re-saved just from loading', {}, async (page) => {
    assert.strictEqual(await val(page, 'bizNameInput'), 'Lee Advisory');
    assert.strictEqual(await val(page, 'legalFirstName'), 'Alice');
    assert.strictEqual(await page.evaluate(() => window.sel.tpl), 'sidebar');
    assert.strictEqual(await page.evaluate(() => window.sel.pal), 'Oxblood');
    assert.strictEqual(await locked(page), false);
    assert.strictEqual(calls('/api/portal/save').length, 0, 'load must not trigger a save');
    assert.strictEqual(calls('/api/portal/prefill')[0].auth, 'tok-1');
  });

  await scenario(browser, 'a draft left by another user on this browser never shows (shared computer)', {
    localStorage: { 'bdcap-form-v1': JSON.stringify({ fields: { bizNameInput: 'PREVIOUS USER CO' }, sel: {} }), 'bdcap-draft-owner': 'someone-else' },
    setup: () => { state.prefill = { fields: {}, sel: {}, status: { ...NOT_LOCKED }, site: {} }; },
  }, async (page) => {
    assert.strictEqual(await val(page, 'bizNameInput'), '');
    const raw = await page.evaluate(() => localStorage.getItem('bdcap-form-v1') || '');
    assert.ok(!raw.includes('PREVIOUS USER CO'));
  });

  await scenario(browser, 'the same user\'s own unsaved draft is kept when the server has nothing yet', {
    localStorage: { 'bdcap-form-v1': JSON.stringify({ fields: { bizNameInput: 'My draft' }, sel: {} }), 'bdcap-draft-owner': 'u-alice' },
    setup: () => { state.prefill = { fields: {}, sel: {}, status: { ...NOT_LOCKED }, site: {} }; },
  }, async (page) => {
    assert.strictEqual(await val(page, 'bizNameInput'), 'My draft');
  });

  await scenario(browser, 'locked: page is read-only, banner shown, Request a change visible', {
    setup: () => {
      const t = iso(-86400000);
      state.prefill.status = { completedOn: t, lockedOn: t, changesUntil: '' };
      state.prefill.sel = { ...SEL, completedOn: t, lockedOn: t, changesUntil: '', changeRequests: [] };
    },
  }, async (page) => {
    assert.strictEqual(await locked(page), true);
    assert.match(await banner(page), /locked on/i);
    await view(page, 'website');
    assert.strictEqual(await page.isVisible('#changeReqBtn'), true);
    await page.evaluate(() => { const e = document.getElementById('bizNameInput'); e.value = 'Changed'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(2600);
    assert.strictEqual(calls('/api/portal/save').length, 0, 'locked page must not save');
  });

  await scenario(browser, 'reopened window: editable again with the "open until" banner', {
    setup: () => {
      const done = iso(-86400000), until = iso(20 * 3600 * 1000);
      state.prefill.status = { completedOn: done, lockedOn: '', changesUntil: until };
      state.prefill.sel = { ...SEL, completedOn: done, lockedOn: '', changesUntil: until, changeRequests: [] };
    },
  }, async (page) => {
    assert.strictEqual(await locked(page), false);
    assert.match(await banner(page), /open until/i);
    assert.strictEqual(await page.evaluate(() => document.getElementById('submitPortal').disabled), false);
  });

  await scenario(browser, 'autosave: one debounced, authenticated save after typing', {}, async (page) => {
    await view(page, 'information');
    await page.fill('#bizNameInput', 'Brand New Name');
    assert.strictEqual(calls('/api/portal/save').length, 0, 'debounced, not immediate');
    await page.waitForTimeout(2800);
    const saves = calls('/api/portal/save');
    assert.strictEqual(saves.length, 1);
    assert.strictEqual(saves[0].auth, 'tok-1');
    assert.strictEqual(saves[0].body.fields.bizNameInput, 'Brand New Name');
    assert.strictEqual(saves[0].body.sel.tpl, 'sidebar');
  });

  const lockedSetup = () => {
    const t = iso(-3600000);
    state.prefill.status = { completedOn: t, lockedOn: t, changesUntil: '' };
    state.prefill.sel = { ...SEL, completedOn: t, lockedOn: t, changesUntil: '', changeRequests: [] };
  };

  await scenario(browser, 'change request: recorded on the server first, then listed as PENDING', { setup: lockedSetup }, async (page) => {
    await view(page, 'website');
    await page.click('#changeReqBtn');
    await page.fill('#changeReqText', 'Please change my tagline');
    await page.selectOption('#changeReqPart', 'website');
    await page.click('#changeReqSend');
    await page.waitForTimeout(800);
    const cr = calls('/api/portal/change-request');
    assert.strictEqual(cr.length, 1);
    assert.strictEqual(cr[0].auth, 'tok-1');
    assert.deepStrictEqual({ type: cr[0].body.type, part: cr[0].body.part, text: cr[0].body.text }, { type: 'change_request', part: 'website', text: 'Please change my tagline' });
    const items = await page.$$eval('#changeReqList .changeReqItem', els => els.map(e => e.textContent));
    assert.strictEqual(items.length, 1);
    assert.match(items[0], /Please change my tagline/);
    assert.match(items[0], /PENDING/);
    assert.strictEqual(await locked(page), true, 'a request never unlocks');
  });

  await scenario(browser, 'change request: if the server fails nothing is shown as sent', { setup: () => { lockedSetup(); state.failPaths.add('/api/portal/change-request'); } }, async (page) => {
    await view(page, 'website');
    await page.click('#changeReqBtn');
    await page.fill('#changeReqText', 'This will fail');
    await page.click('#changeReqSend');
    await page.waitForTimeout(800);
    assert.strictEqual(calls('/api/portal/change-request').length, 1);
    assert.strictEqual(await page.$$eval('#changeReqList .changeReqItem', e => e.length), 0);
    assert.match(await page.textContent('#changeReqError'), /could not send/i);
  });

  await scenario(browser, 'request statuses and the manager note come from the server', {
    setup: () => {
      lockedSetup();
      state.prefill.sel.changeRequests = [
        { id: 'a', at: iso(-7200000), part: 'website', text: 'First one', status: 'approved', adminNote: 'Go ahead' },
        { id: 'b', at: iso(-3600000), part: 'team', text: 'Second one', status: 'rejected', adminNote: 'Not possible' },
        { id: 'c', at: iso(-1800000), part: 'you', text: 'Third one', status: 'pending' },
      ];
    },
  }, async (page) => {
    const items = await page.$$eval('#changeReqList .changeReqItem', els => els.map(e => e.textContent));
    assert.strictEqual(items.length, 3);
    assert.match(items[0], /APPROVED/); assert.match(items[0], /Go ahead/);
    assert.match(items[1], /REJECTED/); assert.match(items[1], /Not possible/);
    assert.match(items[2], /PENDING/);
  });

  const fillRequired = (page) => page.evaluate(() => {
    const set = (c, v) => { c.value = v; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); };
    document.querySelectorAll('#view-information .field, #view-website .field').forEach(f => {
      if (!f.querySelector('.req')) return;
      const c = f.querySelector('input:not([type=checkbox]), select, textarea');
      if (!c || c.readOnly || String(c.value || '').trim()) return;
      if (c.tagName === 'SELECT') { const o = [...c.options].find(x => x.value); if (o) set(c, o.value); }
      else if (c.type === 'email') set(c, 'a@b.co'); else if (c.type === 'date') set(c, '1990-01-01');
      else if (c.type === 'tel') set(c, '5551112222'); else set(c, 'Test');
    });
    return missingRequired();
  });

  await scenario(browser, 'submit: the server is asked first, then the page locks', {}, async (page) => {
    const missing = await fillRequired(page);
    assert.deepStrictEqual(missing, [], 'could not fill every required field: ' + missing);
    await view(page, 'website');
    await page.click('#submitPortal');
    await page.waitForSelector('#confirmSubmit.on');
    assert.strictEqual(calls('/api/portal/submit').length, 0, 'dialog alone submits nothing');
    await page.click('#confirmGo');
    await page.waitForTimeout(1000);
    const sub = calls('/api/portal/submit');
    assert.strictEqual(sub.length, 1);
    assert.strictEqual(sub[0].auth, 'tok-1');
    assert.strictEqual(sub[0].body.fields.bizNameInput, 'Lee Advisory');
    assert.strictEqual(await locked(page), true);
    assert.strictEqual(await page.textContent('#submitPortal'), 'Submitted');
    await page.waitForTimeout(2600);
    assert.strictEqual(calls('/api/portal/save').filter(c => c.body && c.body.fields.bizNameInput === 'Lee Advisory').length <= 1, true);
  });

  await scenario(browser, 'submit: if the server fails the page does NOT lock', { setup: () => state.failPaths.add('/api/portal/submit') }, async (page) => {
    await fillRequired(page);
    await view(page, 'website');
    await page.click('#submitPortal');
    await page.waitForSelector('#confirmSubmit.on');
    await page.click('#confirmGo');
    await page.waitForTimeout(1000);
    assert.strictEqual(calls('/api/portal/submit').length, 1);
    assert.strictEqual(await locked(page), false);
    assert.match(await page.textContent('#submitStatus'), /could not submit/i);
  });

  await scenario(browser, 'dismissing the confirm dialog sends nothing', {}, async (page) => {
    await fillRequired(page);
    await view(page, 'website');
    await page.click('#submitPortal');
    await page.waitForSelector('#confirmSubmit.on');
    await page.click('#confirmReturn');
    await page.waitForTimeout(500);
    assert.strictEqual(calls('/api/portal/submit').length, 0);
    assert.strictEqual(await locked(page), false);
  });

  await scenario(browser, 'admin view: loads the client read-only, cannot save or send requests, leaves no draft', {
    query: '?viewAs=client-1',
    setup: () => {
      const t = iso(-3600000);
      state.adminPrefill = {
        fields: { ...FULL_FIELDS, bizNameInput: 'Client Co' }, sel: { ...SEL, completedOn: t, lockedOn: t, changesUntil: '', changeRequests: [] },
        status: { completedOn: t, lockedOn: t, changesUntil: '' }, site: {}, client: { id: 'client-1', email: 'client@x.com', name: 'Client' },
      };
    },
  }, async (page) => {
    assert.strictEqual(calls('/api/portal/prefill').length, 0);
    assert.strictEqual(calls('/api/admin/clients/client-1/prefill').length, 1);
    assert.strictEqual(await val(page, 'bizNameInput'), 'Client Co');
    assert.strictEqual(await locked(page), true);
    assert.match(await banner(page), /Viewing .*client@x\.com.* as admin/i);
    await view(page, 'website');
    assert.strictEqual(await page.isVisible('#changeReqBtn'), false);
    await page.evaluate(() => { const e = document.getElementById('bizNameInput'); e.value = 'tamper'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(2600);
    assert.strictEqual(calls('/api/portal/save').length, 0);
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('bdcap-form-v1')), null);
  });

  await scenario(browser, 'expired access token: refreshed through the backend and the call is retried', { setup: () => { state.validTokens = new Set(); } }, async (page) => {
    assert.strictEqual(calls('/api/auth/refresh').length, 1);
    assert.strictEqual(state.calls.filter(c => c.url === '/api/auth/refresh')[0].body.refresh_token, 'ref-1');
    const pre = calls('/api/portal/prefill');
    assert.deepStrictEqual(pre.map(c => c.auth), ['tok-1', 'tok-2']);
    assert.strictEqual(await val(page, 'bizNameInput'), 'Lee Advisory');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bdcap-session-v1')));
    assert.strictEqual(stored.access_token, 'tok-2');
    assert.strictEqual(stored.refresh_token, 'ref-2');
  });

  await scenario(browser, 'signed out: redirected to /login', { noSession: true }, async (page) => {
    assert.match(page.url(), /\/login\?next=/);
    assert.strictEqual(state.calls.length, 0);
  });

  await browser.close();
  server.close();
  console.log(`\n=== Browser results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed ? 1 : 0);
})();

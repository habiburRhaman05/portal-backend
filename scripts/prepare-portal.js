#!/usr/bin/env node
// Builds the portal page for the dedicated frontend.
//   node scripts/prepare-portal.js [--out <file>]
// Allowed edits to the source HTML (plan section 0, rule 3):
//   1. remove the .protonav block and its CSS rules
//   2. inject patches/portal-pre.js (end of <head>) and patches/portal-wiring.js (before the last </body>)
// The second HTML document carried inside <script id="previewEngineSrc"> must stay byte-identical.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > -1
  ? path.resolve(process.argv[outArg + 1])
  : path.join(root, '..', 'portal-frontend', 'public', 'portal', 'index.html');

const candidates = [
  path.join(root, 'docs', 'handoff', 'BDCap Client Portal.html'),
  path.join(root, '..', 'frontend-portal', 'BDCap Client Portal.html'),
];
const SRC = candidates.find(fs.existsSync);
if (!SRC) {
  console.error('Source portal not found. Checked:\n  ' + candidates.join('\n  '));
  process.exit(1);
}

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const read = (name) => {
  const code = fs.readFileSync(path.join(root, 'patches', name), 'utf8');
  new Function(code); // syntax check; throws on a typo
  if (/<\/script/i.test(code)) throw new Error(name + ' must not contain </script>');
  return code;
};

const ENGINE_RE = /(<script id="previewEngineSrc"[^>]*>)([\s\S]*?)(<\/script>)/;
const source = fs.readFileSync(SRC, 'utf8');
const engineBefore = source.match(ENGINE_RE);
if (!engineBefore) throw new Error('previewEngineSrc block not found in the source');

let html = source;

// 1. protonav
const protonav = /<div class="protonav">[\s\S]*?<\/div>\s*<\/div>/;
if (protonav.test(html)) html = html.replace(protonav, '<!-- protonav removed for production -->');
let cssRemoved = 0;
for (const rule of [
  /\s*\.protonav\{[^}]*\}/g, /\s*\.protonav\s+\.wrap\{[^}]*\}/g, /\s*\.protonav\s+\.tag\{[^}]*\}/g,
  /\s*\.protonav\s+a\{[^}]*\}/g, /\s*\.protonav\s+a:hover\{[^}]*\}/g, /\s*\.protonav\s+a\.active\{[^}]*\}/g,
]) {
  const before = html.length;
  html = html.replace(rule, '');
  if (html.length < before) cssRemoved++;
}

// 2. injections, anchored OUTSIDE the engine block (it contains its own </head> and </body>)
const engine = html.match(ENGINE_RE);
const engineStart = engine.index;
const engineEnd = engine.index + engine[0].length;

const headAt = html.indexOf('</head>');
if (headAt < 0 || headAt > engineStart) throw new Error('could not find the real </head> before the engine block');
html = html.slice(0, headAt) + '<script>\n' + read('portal-pre.js') + '\n</script>\n' + html.slice(headAt);

const bodyAt = html.lastIndexOf('</body>');
const engineEndNow = html.match(ENGINE_RE).index + html.match(ENGINE_RE)[0].length;
if (bodyAt < engineEndNow) throw new Error('could not find the real </body> after the engine block');
html = html.slice(0, bodyAt) + '<script>\n' + read('portal-wiring.js') + '\n</script>\n' + html.slice(bodyAt);

// 3. the engine block must be exactly what shipped
const engineAfter = html.match(ENGINE_RE);
if (!engineAfter || engineAfter[2] !== engineBefore[2]) {
  throw new Error('previewEngineSrc changed. Refusing to write the output.');
}
const outside = html.replace(ENGINE_RE, '');
for (const marker of ['/api/portal/prefill', '/api/portal/submit', '__BDCAP']) {
  if (!outside.includes(marker)) throw new Error('patch marker missing outside the engine block: ' + marker);
}
if (engineAfter[2].includes('/api/portal/prefill')) throw new Error('wiring leaked into the engine block');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');

console.log(`Source : ${SRC}`);
console.log(`Output : ${OUT}`);
console.log(`protonav + ${cssRemoved} CSS rules removed; pre-script and wiring injected`);
console.log(`previewEngineSrc identical (md5 ${md5(engineAfter[2])}, ${engineAfter[2].length} chars)`);
console.log(`size ${source.length} -> ${html.length} bytes`);

#!/usr/bin/env node
// Port the stateless alias de-leak to the running 9router 0.5.104 install.
//
// A pristine 0.5.104 still hands the client `read_client`: every anchor from 0.5.99
// survives unchanged (verified: 3 toolNameMap sites, the passthrough branch, its (f||j)
// re-serialisation gate, the verbatim fallback). Upstream's source-level restoreToolNames
// does not cover this path.
//
// Only the stateless pieces are applied. Module 60210 is deliberately left alone: 0.5.104
// ships a newer version of it and replacing it with the 0.5.99-derived module would throw
// upstream's own work away.
const fs = require('fs');
const path = require('path');

const ROOT = '/mnt/d/npm-global/node_modules/9router';
const DATA = JSON.parse(fs.readFileSync('/tmp/patch_data.json', 'utf8'));
const CHUNKS = path.join(ROOT, 'app/.next-cli-build/server/chunks');
const f8499 = path.join(CHUNKS, '8499.js');
const f8895 = path.join(CHUNKS, '8895.js');

const version = require(path.join(ROOT, 'package.json')).version;
if (version !== '0.5.104') { console.error('REFUSING: target is ' + version); process.exit(1); }

function subOnce(src, from, to, label) {
  if (src.includes(to)) { console.log('SKIP [' + label + '] already applied'); return src; }
  const n = src.split(from).length - 1;
  if (n === 0) { console.log('SKIP [' + label + '] anchor absent in this build'); return src; }
  if (n !== 1) { console.error('FATAL [' + label + ']: ' + n + ' occurrences'); process.exit(1); }
  console.log('OK   [' + label + ']');
  return src.replace(from, to);
}

let a = fs.readFileSync(f8499, 'utf8');
let b = fs.readFileSync(f8895, 'utf8');
let ta = false, tb = false;

for (const r of DATA.p8499.replacements) {
  const before = a; a = subOnce(a, r.from, r.to, r.label); if (a !== before) ta = true;
}
for (const r of DATA.p8895.replacements) {
  const before = b; b = subOnce(b, r.from, r.to, r.label); if (b !== before) tb = true;
}

new Function(a);            // syntax gate before any write
new Function(b);

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
if (ta) { fs.copyFileSync(f8499, f8499 + '.bak.' + stamp); fs.writeFileSync(f8499, a); console.log('WROTE 8499.js (backup .bak.' + stamp + ')'); }
if (tb) { fs.copyFileSync(f8895, f8895 + '.bak.' + stamp); fs.writeFileSync(f8895, b); console.log('WROTE 8895.js (backup .bak.' + stamp + ')'); }
if (!ta && !tb) console.log('nothing to do');
console.log('module 60210 untouched');

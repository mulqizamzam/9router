#!/usr/bin/env node
// Re-apply the opencode /inference/v1 bundle patch to a 9router npm install.
// Usage: node apply_patch.cjs <9router-root>
// Data: patch_data.json (sibling file) — verified-good byte sequences.
// Idempotent; aborts without writing if a needle drifts (version mismatch).
const fs = require('fs'), path = require('path');
const root = process.argv[2];
if (!root) { console.error('usage: node apply_patch.cjs <9router-root>'); process.exit(2); }

// This kit patches the BUILT BUNDLE of one specific release. Upstream fixed the
// tool-alias bug in source (opencodeFingerprint.js restoreToolNames + the translator
// response path), so this kit is OBSOLETE for 9router >= 0.5.104: upgrade instead.
const SUPPORTED_VERSION = '0.5.99';
const targetVersion = (() => { try { return require(path.join(root, 'package.json')).version } catch { return null } })();
if (targetVersion !== SUPPORTED_VERSION) {
  console.error('REFUSING: this kit targets 9router ' + SUPPORTED_VERSION + ', target is ' + (targetVersion || 'unknown'));
  console.error('Upstream fixed the tool-alias bug in source; upgrade rather than patch the bundle.');
  process.exit(1);
}
console.log('target version OK: ' + targetVersion);
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'patch_data.json'), 'utf8'));
const p5330 = path.join(root, 'app/.next-cli-build/server/chunks/5330.js');
const p8499 = path.join(root, 'app/.next-cli-build/server/chunks/8499.js');
const p8895 = path.join(root, 'app/.next-cli-build/server/chunks/8895.js');
for (const p of [p5330, p8499, p8895]) if (!fs.existsSync(p)) { console.error('missing', p); process.exit(1); }

function subOnce(src, from, to, label) {
  if (src.includes(to)) { console.log('SKIP [' + label + '] already patched'); return src; }
  const n = src.split(from).length - 1;
  if (n === 0) { console.log('SKIP [' + label + '] already patched'); return src; }
  if (n !== 1) { console.error('FATAL [' + label + ']: ' + n + ' occurrences - bundle version mismatch'); process.exit(1); }
  console.log('OK   [' + label + ']');
  return src.replace(from, to);
}

let s = fs.readFileSync(p5330, 'utf8');
for (const r of data.p5330.replacements) s = subOnce(s, r.from, r.to, r.label);
const patched5330 = s !== fs.readFileSync(p5330, 'utf8');
if (patched5330) fs.writeFileSync(p5330, s);

s = fs.readFileSync(p8499, 'utf8');
let touched8499 = false;
if (s.includes('c=_wrap(c)')) {
  console.log('SKIP 8499.js module already patched');
} else {
  const m = s.indexOf('60210:(a,b,c)=>{');
  if (m < 0) { console.error('FATAL: module 60210 not found'); process.exit(1); }
  let i = s.indexOf('=>{', m) + 2, depth = 0, inS = null, end = -1;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inS) { if (ch === inS && s[i-1] !== '\\') inS = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inS = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) { console.error('FATAL: module 60210 end not found'); process.exit(1); }
  s = s.slice(0, m) + data.p8499.newModule60210 + s.slice(end);
  touched8499 = true;
}
for (const r of (data.p8499.replacements || [])) {
  const before = s;
  s = subOnce(s, r.from, r.to, r.label);
  if (s !== before) touched8499 = true;
}
if (touched8499) { fs.writeFileSync(p8499, s); console.log('WROTE', p8499); }
s = fs.readFileSync(p8895, 'utf8');
let touched8895 = false;
for (const r of data.p8895.replacements) {
  const before = s;
  s = subOnce(s, r.from, r.to, r.label);
  if (s !== before) touched8895 = true;
}
if (touched8895) { fs.writeFileSync(p8895, s); console.log('WROTE', p8895); }
console.log('DONE. Verify: node --check ' + p5330 + ' ' + p8499 + ' ' + p8895 + ' && node proof_test.cjs');

#!/usr/bin/env node
// Port the thinking fix to the running 9router 0.5.104 bundle.
//
// Two coordinated edits, mirroring the source fix:
//   1. NATIVE_ONLY set gains "zai", so a model-level Z.AI format no longer travels on an
//      OpenAI wire (falls back to reasoning_effort).
//   2. glm and glm-cn declare thinkingFormat:"zai" on their transport, so Z.AI's own
//      native field is preserved where it is genuinely accepted.
//
// The registry is duplicated across three chunks by the bundler, and each carries its own
// copy of both providers, so every occurrence must be patched or the fix depends on which
// chunk the router happens to load.
const fs = require('fs');
const path = require('path');

const ROOT = '/mnt/d/npm-global/node_modules/9router';
const CHUNKS = path.join(ROOT, 'app/.next-cli-build/server/chunks');
if (require(path.join(ROOT, 'package.json')).version !== '0.5.104') { console.error('REFUSING: not 0.5.104'); process.exit(1); }

const SET_FROM = 'new Set(["gemini-level","gemini-budget","claude-budget","claude-adaptive","kiro"])';
const SET_TO = 'new Set(["gemini-level","gemini-budget","claude-budget","claude-adaptive","kiro","zai"])';
const SIGS = [
  'transport:{baseUrl:"https://api.z.ai/api/anthropic/v1/messages"',
  'transport:{baseUrl:"https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"',
];

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
let setPatched = 0, sigPatched = 0, files = 0;

for (const f of fs.readdirSync(CHUNKS).filter((x) => x.endsWith('.js'))) {
  const p = path.join(CHUNKS, f);
  let s = fs.readFileSync(p, 'utf8');
  const before = s;

  const nSet = s.split(SET_FROM).length - 1;
  if (nSet > 1) { console.error('FATAL [' + f + ']: NATIVE_ONLY set ' + nSet + 'x'); process.exit(1); }
  if (nSet === 1) { s = s.replace(SET_FROM, SET_TO); setPatched++; }

  for (const sig of SIGS) {
    const n = s.split(sig).length - 1;
    if (n > 1) { console.error('FATAL [' + f + ']: ' + sig.slice(0, 40) + ' ' + n + 'x'); process.exit(1); }
    if (n === 1) { s = s.replace(sig, sig.replace('transport:{', 'transport:{thinkingFormat:"zai",')); sigPatched++; }
  }

  if (s !== before) {
    new Function(s);                                    // syntax gate before any write
    fs.copyFileSync(p, p + '.bak.' + stamp);
    fs.writeFileSync(p, s);
    files++;
    console.log('WROTE ' + f);
  }
}

console.log('NATIVE_ONLY edits: ' + setPatched + '  provider declarations: ' + sigPatched + '  files: ' + files);
if (setPatched !== 1) console.error('WARNING: expected exactly 1 NATIVE_ONLY set, got ' + setPatched);
if (sigPatched !== 6) console.error('WARNING: expected 6 provider transports, got ' + sigPatched);

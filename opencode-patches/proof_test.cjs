#!/usr/bin/env node
// Proof test for the 9router opencode /inference/v1 patch.
// - Asserts executor markers in 5330.js (endpoint, UA, headers).
// - Loads module 60210 (fingerprint) from 8499.js in a fake webpack context and
//   exercises Ke (applyFingerprintTools), g4 (takeRenamedToolNames), HR (restore).
// Fails on the unpatched chunks, passes on the patched ones.
const fs = require('fs');

// Override the chunk directory to prove the regression checks below fail on an
// unpatched bundle: NINE_ROUTER_CHUNKS=<dir with the old 8499.js> node proof_test.cjs
const CHUNKS = process.env.NINE_ROUTER_CHUNKS
  || '/mnt/c/Users/Administrator/AppData/Roaming/npm/node_modules/9router/app/.next-cli-build/server/chunks';
const c8499 = fs.readFileSync(`${CHUNKS}/8499.js`, 'utf8');
const c5330 = fs.readFileSync(`${CHUNKS}/5330.js`, 'utf8');
const c8895 = fs.readFileSync(`${CHUNKS}/8895.js`, 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS ${name}`);
  else { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); failures++; }
}

// ---------------- 5330.js: executor markers ----------------
check('buildUrl uses /inference/v1', c5330.includes('/inference/v1/responses') && c5330.includes('/inference/v1/chat/completions') && c5330.includes('/inference/v1/messages'));
check('no /zen/v1 endpoint left in 5330', !/\/zen\/v1\/(responses|chat\/completions|messages)/.test(c5330));
check('v2 UA default', c5330.includes('opencode/latest/2.0.26/cli'));
check('v2 UA validation regex', c5330.includes('[a-z0-9-]+\\/(\\d+)\\.\\d+\\.\\d+\\/[a-z0-9-]+'));
check('x-opencode-session-id header', c5330.includes('"x-opencode-session-id"'));
check('x-session-affinity header', c5330.includes('"x-session-affinity"'));
check('x-session-id header', c5330.includes('"x-session-id"'));
check('x-opencode-request dropped from headers', !/"x-opencode-request":/.test(c5330.slice(c5330.indexOf('buildHeaders'))));
check('default client cli', c5330.includes('||"cli"'));

// ---------------- 8499.js: module 60210 behavior ----------------
const m = c8499.indexOf('60210:(a,b,c)=>{');
check('module 60210 present', m >= 0);
if (m >= 0) {
  // extract the module arrow "(a,b,c)=>{...}" with a string-aware brace walk
  const start = c8499.indexOf('=>{', m) + 2; // position of the arrow-body "{"
  let i = start, depth = 0, inS = null, end = -1;
  for (; i < c8499.length; i++) {
    const ch = c8499[i];
    if (inS) { if (ch === inS && c8499[i - 1] !== '\\') inS = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inS = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const arrow = c8499.slice(m + 6, end); // "(a,b,c)=>{...}"
  // Run the arrow in a fake webpack context: intercept c.d to capture export defs.
  const defsArg = {};
  const cRec = (id) => { throw new Error('module 60210 must not import modules, got ' + id); };
  cRec.d = (target, defs) => { Object.assign(defsArg, defs); };
  let Ke, g4, HR;
  try {
    const factory = eval(arrow); // valid expression "(a,b,c)=>{...}"
    factory(null, {}, cRec);
    Ke = defsArg.Ke(); g4 = defsArg.g4(); HR = defsArg.HR();
    check('module 60210 executes and exports Ke/g4/HR', typeof Ke === 'function' && typeof g4 === 'function' && typeof HR === 'function');
  } catch (e) {
    check('module 60210 executes', false, e.message);
    console.log('cannot continue');
    process.exit(1);
  }

  // (a) responses path: colliding caller tool aliased, case variant kept, verbatim defs appended
  const body1 = {
    model: 'muse-spark-1.3-contributor-free',
    tools: [
      { type: 'function', name: 'read', description: 'my custom read', parameters: { type: 'object', properties: {} } },
      { type: 'function', name: 'Grep', description: 'case variant stays', parameters: { type: 'object', properties: {} } },
    ],
  };
  const map1 = Ke(body1, true);
  const names = body1.tools.map(t => t.name || t.function && t.function.name);
  check('colliding caller tool aliased read_client', names.includes('read_client'), JSON.stringify(names));
  check('case variant Grep preserved', names.includes('Grep'));
  check('verbatim shell appended', names.includes('shell'));
  check('exactly one "read" in sent tools', names.filter(n => n === 'read').length === 1);
  check('rename map read_client->read', map1 instanceof Map && map1.get('read_client') === 'read');
  check('g4 returns recorded map', g4(body1) === map1);
  check('responses tool_choice defaults auto', body1.tool_choice === 'auto');
  check('placeholder note in instructions', typeof body1.instructions === 'string' && body1.instructions.includes('placeholders that do nothing'));

  // (b) chat path: no "none" default, note goes to a system message
  const body2 = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };
  Ke(body2, false);
  check('chat tool_choice not "none"', body2.tool_choice === undefined || body2.tool_choice === 'auto');
  check('chat note becomes system message', body2.messages[0].role === 'system' && body2.messages[0].content.includes('placeholders'));
  check('user message preserved', body2.messages[1] && body2.messages[1].role === 'user');

  // (c) verbatim-definition caller tool is not aliased
  const body3 = { tools: [] };
  Ke(body3, false);
  const verbatim = JSON.parse(JSON.stringify(body3.tools));
  const body4 = { tools: verbatim };
  const map4 = Ke(body4, false);
  check('exact-def caller tools not aliased', map4.size === 0, 'map size ' + map4.size);

  // (d) HR restores caller spellings in responses payloads
  const map5 = new Map([['read_client', 'read']]);
  const restored = HR({ output: [{ type: 'function_call', name: 'read_client', arguments: '{}' }] }, map5);
  check('HR restores output function_call names', restored.output[0].name === 'read');

  // (f) REGRESSION: the alias map can be lost. LLM retries rebuild the request body,
  // so the WeakMap lookup in g4() misses and callers hand HR a null/empty map; a
  // stateless caller never had one. Before the fix HR returned the payload untouched
  // and the client received a tool name it never declared -> 'unknown tool "read_client"'.
  const resp = () => ({ output: [{ type: 'function_call', name: 'read_client', arguments: '{}' }] });
  const noMap = HR(resp(), null);
  check('HR restores alias when map is null', noMap.output[0].name === 'read', noMap.output[0].name);
  const emptyMap = HR(resp(), new Map());
  check('HR restores alias when map is empty', emptyMap.output[0].name === 'read', emptyMap.output[0].name);
  const numbered = HR({ output: [{ type: 'function_call', name: 'read_client2', arguments: '{}' }] }, null);
  check('HR restores numbered alias', numbered.output[0].name === 'read', numbered.output[0].name);

  // (e) history aliasing: prior-turn calls renamed to the alias
  const body6 = {
    tools: [{ type: 'function', name: 'read', description: 'custom', parameters: { type: 'object', properties: {} } }],
    input: [{ type: 'function_call', name: 'read', call_id: 'x', arguments: '{}' }],
  };
  Ke(body6, true);
  check('prior-turn call aliased in history', body6.input[0].name === 'read_client');
}

check('old stub description gone', !c8499.includes('This tool is currently unavailable and must not be used'));

// ---------------- 8895.js: streaming (SSE) path ----------------
// REGRESSION. The four (0,X.HR)(...) sites in 8895.js are all non-streaming JSON
// responses; the SSE body is assembled separately, so before this fix a streamed tool
// call carried the raw read_client alias to a client that never declared it:
//   unknown tool "read_client"
// The checks above stopped at the non-streaming path, which is why the suite was
// green while the live symptom persisted.
const sseAt = c8895.indexOf('k=k.map(s=>s.replace(');
check('8895.js carries an SSE alias post-pass', sseAt >= 0);
check('SSE post-pass sits before the [DONE] sentinel',
  sseAt >= 0 && c8895.indexOf('k.push("data: [DONE]', sseAt) > sseAt);
// The SSE builder must still RETURN its response object. An earlier revision of this
// patch replaced `return k.push(...)` with a bare statement, which would have made the
// streaming path return undefined. Slicing only the rewrite statement cannot see that,
// so the surrounding return is asserted here.
check('SSE post-pass keeps the return',
  sseAt < 0 || /return k=k\.map\(s=>s\.replace\(/.test(c8895),
  sseAt < 0 ? 'not applicable' : 'return keyword missing');
check('SSE builder still returns its response',
  /return k=k\.map\([\s\S]{0,400}?response:new Response\(k\.join\(""\)/.test(c8895));

const sseChunk =
  '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function",' +
  '"function":{"name":"PLACEHOLDER","arguments":"{}"}}]}}]}';

/** Name a client would observe for a streamed tool call, after the shipped rewrite. */
function streamedName(name) {
  const line = sseChunk.replace('PLACEHOLDER', name);
  if (sseAt < 0) return JSON.parse(line).choices[0].delta.tool_calls[0].function.name;
  const end = c8895.indexOf('k.push("data: [DONE]', sseAt);
  if (end < 0) throw new Error('SSE post-pass has no terminator');
  const stmt = c8895.slice(sseAt, end).replace(/,\s*$/, '');
  const out = new Function('k', stmt + '; return k;')([line]);
  return JSON.parse(out[0]).choices[0].delta.tool_calls[0].function.name;
}

for (const [alias, original] of [
  ['read_client', 'read'], ['read_client2', 'read'],
  ['shell_client', 'shell'], ['shell_client3', 'shell'],
]) {
  const got = streamedName(alias);
  check('streamed ' + alias + ' -> ' + original, got === original, got);
}
for (const name of ['bash', 'glob', 'Read', 'read_client_extra', 'my_client']) {
  const got = streamedName(name);
  check('streamed ' + name + ' unchanged', got === name, got);
}

// ---------------- 8499.js: toolNameMap alias fallback ----------------
// ROOT CAUSE. The opencode executor (module 4493, 5330.js) calls module 60210's Ke,
// which CREATES the alias `read` -> `read_client`, and never calls a reverser. The
// reversal happens where a name is resolved from the recovered alias map, and that
// lookup is `toolNameMap?.get(name) || name` — so when the WeakMap recovery misses, the
// fallback hands the client the raw alias, which it answers with
//   unknown tool "read_client"
// Three such sites exist, all in 8499.js, and each now falls back to a stateless
// resolver instead of the raw value.
check('8499.js carries the stateless alias helper', /var __dshDa=function\(n\)/.test(c8499));
const REWIRED = [
  'g=b.toolNameMap?.get(d.name)||__dshDa(d.name),',
  'e=b.toolNameMap?.get(d)||__dshDa(d),',
  'e=b.toolNameMap?.get(c.name)||__dshDa(c.name);',
];
const rewired = REWIRED.filter((site) => c8499.includes(site)).length;
check('8499.js rewires all 3 toolNameMap fallbacks', rewired === 3, rewired + '/3');

const helperMatch = /var __dshDa=(function\(n\)\{[\s\S]*?\});/.exec(c8499);
if (helperMatch) {
  // eslint-disable-next-line no-eval -- run the helper bytes shipped in the chunk
  const resolve = eval('(' + helperMatch[1] + ')');
  const miss = new Map(); // the recovered alias map missed
  const at = (n) => (miss.get(n) !== undefined ? miss.get(n) : resolve(n));
  for (const [input, want] of [
    ['read_client', 'read'], ['read_client2', 'read'], ['shell_client3', 'shell'],
    ['bash', 'bash'], ['glob', 'glob'], ['Read', 'Read'],
    ['read_client_extra', 'read_client_extra'], ['my_client', 'my_client'],
  ]) {
    check('alias-map miss: ' + input + ' -> ' + want, at(input) === want, at(input));
  }
} else {
  check('alias-map miss resolves read_client', false, 'helper absent');
}

// ---------------- 8895.js: passthrough branch (the actual path) ----------------
// Module 71857 has two modes. The context that carries `toolNameMap` is built only in
// "translate":
//     function o(...){return n({mode:l/*translate*/,...,toolNameMap:e,...})}   // i5
//     function p(a,b,c,d,e,f,g){return n({mode:m/*passthrough*/,provider:a,...})} // l2
//     C = b===l ? {...(0,d.Ws)(o),toolNameMap:r,...} : null
// so on the passthrough path nothing ever reverses the alias module 60210 created.
// The passthrough branch already parses each complete SSE line into an object, and the
// rewrite is attached there.
check('8895.js carries the passthrough alias rewriter', c8895.includes('var R=function(v)'));
check('8895.js rewrites choices[].delta/message tool names',
  c8895.includes('t.function.name=R(t.function.name)'));
check('8895.js rewrites Responses output/item names',
  c8895.includes('u.name=R(u.name)') && c8895.includes('o.item.name=R(o.item.name)'));
check('passthrough injection is a terminated statement',
  c8895.includes('})(a);') && !c8895.includes('})(a),'));

const ptStart = c8895.indexOf('(function(o){var R=function(v){');
const ptStop = c8895.indexOf('})(a);', ptStart);
const ptMatch = ptStart >= 0 && ptStop > ptStart ? [c8895.slice(ptStart, ptStop + 1)] : null;
if (ptMatch) {
  // eslint-disable-next-line no-eval -- run the bytes shipped in the chunk
  const rewrite = eval(ptMatch[0] + ')');
  const cases = [
    [{ choices: [{ delta: { tool_calls: [{ function: { name: 'read_client' } }] } }] }, 'read'],
    [{ choices: [{ delta: { tool_calls: [{ function: { name: 'read_client2' } }] } }] }, 'read'],
    [{ choices: [{ message: { tool_calls: [{ function: { name: 'shell_client3' } }] } }] }, 'shell'],
    [{ output: [{ type: 'function_call', name: 'read_client' }] }, 'read'],
    [{ item: { type: 'function_call', name: 'read_client' } }, 'read'],
  ];
  for (const [payload, want] of cases) {
    rewrite(payload);
    const got = payload.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name
      ?? payload.choices?.[0]?.message?.tool_calls?.[0]?.function?.name
      ?? payload.output?.[0]?.name ?? payload.item?.name;
    check('passthrough rewrite -> ' + want, got === want, got);
  }
  const passthrough = [{ choices: [{ delta: { tool_calls: [{ function: { name: 'bash' } }] } }] }];
  rewrite(passthrough);
  check('passthrough leaves bash unchanged',
    passthrough[0].choices[0].delta.tool_calls[0].function.name === 'bash',
    passthrough[0].choices[0].delta.tool_calls[0].function.name);
} else {
  check('passthrough rewriter runs', false, 'not found in chunk');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

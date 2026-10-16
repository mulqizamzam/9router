## Still required on 0.5.104 (measured, not assumed)

The banner that used to sit here said upstream had fixed this in source. **That was
wrong.** A pristine 0.5.104 still answers `unknown tool "read_client"`, and every anchor
this kit patches survives unchanged in that build:

```
8499 toolNameMap?.get(            : 3
8499 site A1 / A2 / A3            : 1 / 1 / 1
8895 passthrough branch           : 1
8895 (f||j) re-serialisation gate : 1
8895 verbatim fallback            : 1
```

Upstream's source-level `restoreToolNames` does not cover this path — it returns the
payload untouched whenever the recovered rename map is empty, and on this route it is.

### Applying to 0.5.104

`apply-0.5.104.cjs <9router-root>` applies **only the stateless pieces**: the `__dshDa`
helper, the three `toolNameMap` fallbacks, the passthrough rewriter and the SSE post-pass.
It deliberately does **not** touch module 60210: 0.5.104 ships a newer version of that
module and swapping in the 0.5.99-derived one would discard upstream work.

Verified after applying to the running install (D:\npm-global, 0.5.104): all four
touched chunks parse, the stateless checks in `proof_test.cjs` pass, and the three HR
checks fail by design — they cover the 0.5.99 module-60210 fix this port omits.

# 9router opencode /inference/v1 bundle patch

Workaround untuk bug 403 FreeTierError pada 9router npm 0.5.99 (pre-PR #4842 upstream).
Patch menyasar bundle minified Next.js, bukan source — jadi hilang bila `npm update -g 9router`.

## File target (Windows)
- `C:\Users\Administrator\AppData\Roaming\npm\node_modules\9router\app\.next-cli-build\server\chunks\5330.js`
- `C:\Users\Administrator\AppData\Roaming\npm\node_modules\9router\app\.next-cli-build\server\chunks\8499.js`

## Isi patch (mirror decolua/9router PR #4842, commit ccfb783)
- 5330.js: buildUrl `/zen/v1/*` → `/inference/v1/*`; UA `opencode/latest/2.0.26/cli` + validasi v2;
  buang `x-opencode-request`; tambah `x-opencode-session-id`/`x-session-affinity`/`x-session-id`;
  default client `cli`.
- 8499.js (module 60210): fingerprint `read`/`shell` verbatim menggantikan quartet stub
  `bash/glob/grep/read`; aliasing tool caller bentrok (`read_client`); placeholder note;
  `tool_choice` default `auto` (tidak pernah `none`).

## Re-apply
```
node apply_patch.cjs   # idempotent; abort bila needle tidak cocok (versi beda)
node proof_test.cjs     # harus ALL PASS
node --check <kedua file chunk>
```
Lalu restart server 9router di Windows.

## Bukti
proof_test.cjs: 26/26 PASS di kode terpatch, 10 FAILURE di backup original (revert-and-run).

## Alias leak fix (module 60210)

Caller tools that collide with the fingerprint quartet are aliased on the way out
(`read` -> `read_client`). The reverse rename used to depend on a `WeakMap` keyed by
the request-body object, so it only applied while that exact object stayed reachable.
Any path that loses the identity — an LLM retry rebuilding the body, a stateless
caller — handed the raw alias back to the client, which never declared it:

    unknown tool "read_client"

The alias is reversible by construction (`read_client`, `read_client2` -> `read`), so
the rewrite now derives the original name from the name itself and keeps no state.
`HR` no longer bails out on a missing map, and `_wrap` falls back to the suffix rule
whenever the recorded map does not contain the name.

Regression checks `HR restores alias when map is null / empty / numbered` cover it.
They fail on the pre-fix bundle and pass on the patched one. Point them at an older
chunk to confirm:

    NINE_ROUTER_CHUNKS=/path/to/old/chunks node proof_test.cjs
## SSE tool-alias leak fix (module 60210 + chunk 8895.js)

Caller tools that collide with the fingerprint quartet are aliased on the way out
(`read` -> `read_client`). The reverse rename ran in module 60210's `HR`, but only at
four NON-streaming sites in `8895.js`, each shaped
`new Response(JSON.stringify((0,X.HR)(payload, map)), ...)`.

The streaming path assembles its body separately:

```js
function l(a,b,c){
  let d=j(b,c), g=(0,e.Ws)(a); g.model=b;
  let i=m(d), k=[];
  for(let b of i){
    let c=(0,e.Y8)(f.h.OPENAI,a,b,g);
    if(c?.length>0) for(let b of c) k.push((0,h.v8)(b,a))   // <- no rewrite here
  }
  ...
  new Response(k.join(""), {headers:{"Content-Type":"text/event-stream",...}})
}
```

Any client that streams `openai-completions` therefore received a tool name it never
declared, which it answers with `unknown tool "read_client"`.

The alias is reversible by construction, so the fix needs no state and no module-scope
variable: one post-pass over the assembled lines, anchored immediately before the
`[DONE]` sentinel.

```js
k=k.map(s=>s.replace(/"name":"((?:read|shell)_client\d*)"/g,(m,n)=>'"name":"'+n.replace(/_client\d*$/,"")+'"')),
```

Only `read`/`shell` aliases match, so `bash`, `glob`, `Read`, `read_client_extra`,
`my_client` and every other tool pass through byte-identical.

`proof_test.cjs` now covers the streaming path too. Its earlier checks stopped at the
non-streaming branch, which is why the suite reported green while the live symptom
persisted. Point it at an older chunk to confirm the new checks fail:

    NINE_ROUTER_CHUNKS=/path/to/old/chunks node proof_test.cjs

`apply_patch.cjs` was extended to apply `p8895.replacements` to `8895.js`, idempotent
and aborting on anchor drift like the other targets.


### Correction: the rewrite must stay inside the `return`

The first revision of this patch replaced

```js
return k.push("data: [DONE]\n\n"),
```

with a bare statement, dropping the `return`. The SSE builder would then have returned
`undefined` and every streaming response would have been empty after a restart.

The rewrite is now prepended to the returned expression's operand instead:

```js
return k=k.map(s=>s.replace(...)),k.push("data: [DONE]\n\n"),
```

`proof_test.cjs` slices only the rewrite statement, so it could not see the missing
`return`; two checks now assert it directly (`SSE post-pass keeps the return`,
`SSE builder still returns its response`), and a third variant is kept as evidence:

    NINE_ROUTER_CHUNKS=<dir with the broken 8895.js> node proof_test.cjs   # 2 FAILURES
## Root cause: nothing ever reverses the alias on the opencode path

The two earlier fixes were correct for the paths they cover, but they are not the path
this provider takes.

The opencode executor is module `4493` in `5330.js`. It references module 60210 in
exactly two places, and both are the **request** rewriter:

    (0,m.Ke)(b,!0)   /   (0,m.Ke)(b,!1)

`Ke` is what *creates* the alias (`read` -> `read_client`). The executor never calls
`HR` or `g4`. So the alias is produced on every request and reversed on none of them
by the executor itself.

The reversal is supposed to happen where a tool name is resolved from the recovered
alias map. `8895.js` module `92500` recovers that map with `(0,B.g4)(ak)` — a WeakMap
keyed by the request-body object — and passes it down as `toolNameMap`. Every place
that consumes it looks like this:

    toolNameMap?.get(name) || name

When the WeakMap recovery misses, the map is empty and the fallback is the **raw
alias**. There are three such sites, all in `8499.js`:

| site | role |
|---|---|
| `g=b.toolNameMap?.get(d.name)\|\|d.name` | claude stream `tool_use` -> openai `function_call` |
| `e=b.toolNameMap?.get(d)\|\|d` | tool-call builder |
| `e=b.toolNameMap?.get(c.name)\|\|c.name` | accumulated tool calls |

That is the leak: the client is handed `read_client`, a name it never declared, and it
answers `unknown tool "read_client"`.

### Fix

The alias is reversible by construction, so the fallback does not need the map at all.
One stateless helper is installed at the head of `8499.js`:

```js
var __dshDa=function(n){if("string"!=typeof n)return n;
  var m=/^(read|shell)_client\d*$/.exec(n);return m?n.replace(/_client\d*$/,""):n};
```

and each of the three sites falls back to it instead of the raw value:

    toolNameMap?.get(name) || __dshDa(name)

Only `read`/`shell` aliases are rewritten, so every other tool name is byte-identical,
and a map hit still wins when the map is present.

### Why this is the right layer

The map is an optimisation, not the source of truth: the alias carries its own inverse.
Putting the fallback at the point of use covers every consumer of `toolNameMap` at once,
rather than patching each response builder (there are six in `5330.js` alone, and one in
`8895.js`).

## The passthrough path (the one this provider actually takes)

Module 71857 has two modes, and the translator context — the only thing that carries
`toolNameMap` — is built in just one of them:

    function o(...){return n({mode:l /*translate*/, ..., toolNameMap:e, ...})}    // i5
    function p(a,b,c,d,e,f,g){return n({mode:m /*passthrough*/, provider:a, ...})} // l2  <- no toolNameMap
    ...
    C = b===l ? {...(0,d.Ws)(o), toolNameMap:r, ...} : null

So on the passthrough path nothing reverses the alias module 60210 created. The branch
already parses each complete SSE line into an object, so the rewrite is attached there
— object level, one place, all payload shapes:

    (function(o){
      var R=function(v){... /^(read|shell)_client\d*$/ ...};
      if(Array.isArray(o.choices))for(...of["delta","message"])...t.function.name=R(...)
      if(Array.isArray(o.output))...u.name=R(...)
      if(o.item&&"function_call"===o.item.type)...o.item.name=R(...)
    })(a);

That covers every earlier fix at once: HR, the 8895 SSE builder, and the three
`toolNameMap` sites all live inside a context passthrough never builds.

### Two kit bugs found while verifying this

- `subOnce` decided idempotency by the *absence of `from`*. The passthrough `from`
  is a prefix of its own `to`, so it survived patching and was applied twice. `subOnce`
  now also skips when `to` is already present.
- The 8499 module guard used `s.includes('placeholder that does nothing')` — text that
  is present in the ORIGINAL bundle, so on a pristine install the module 60210
  replacement never ran at all. It now checks for the applied marker `c=_wrap(c)`.

Verified from pristine chunks: `node apply_patch.cjs` applies everything, a second run
applies nothing, and the result is byte-identical to the live 8499.js and 8895.js.

## Why the first passthrough rewrite did nothing

Measured, not inferred. With request logging forced on, the same request was captured on
both sides of the proxy:

| file | direction | `read_client` as a tool name |
|---|---|---|
| `4_req_target.json` | 9Router -> upstream | present (498 tools: `read_client`, `read`, `shell`) |
| `7_res_client.txt` | 9Router -> client | **present — leaked** |

The client stream differed from the provider stream by exactly one thing: a `usage`
object appended to the final chunk. The tool-call chunk passed through byte-identical.

The passthrough branch in module 71857 mutates the parsed object — and then decides what
to emit at the very end:

    let p = a.choices?.[0]?.finish_reason;
    if (p && !usage)  { ...; b = `data: ${JSON.stringify(a)}\n`; c = !0 }
    else if (p && A)  { ...; b = `data: ${JSON.stringify(a)}\n`; c = !0 }
    else (f || j) &&  (b = `data: ${JSON.stringify(a)}\n`, c = !0)
    ...
    c || (b = <the ORIGINAL upstream line>)

A tool-call chunk has `finish_reason:null` and needs no normalisation, so `f`, `j` and `p`
are all falsy, `c` stays false, and the ORIGINAL line is emitted. The rewritten object is
discarded. Only the final usage chunk (`p` truthy) is re-serialised — which is exactly the
single difference observed between the two logs.

So the rewrite must set the branch's own re-serialisation flag `j`. That is the whole
correction: `ch&&(j=!0)` after a name actually changes.

Without the logs this would have been a seventh guess: the rewriter was verified only
against the parsed object, never against the emit decision that throws it away.

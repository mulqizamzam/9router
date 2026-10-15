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

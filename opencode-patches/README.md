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

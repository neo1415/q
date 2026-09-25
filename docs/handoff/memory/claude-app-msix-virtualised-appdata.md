---
name: claude-app-msix-virtualised-appdata
description: "Tools installed from inside the Claude desktop app (pnpm corepack shim, corepack cache) live under the MSIX package's LocalCache and are invisible outside the app"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 782a5694-29f2-46aa-acde-6c8d24e943d9
  modified: 2026-09-17T11:34:28.732Z
---

The Claude desktop app is an MSIX package (`Claude_pzs8sxrjxfjjc`). Its shells see `C:\Users\DELL\AppData\Local\corepack-shims\pnpm.CMD`, but on the real disk that file is `C:\Users\DELL\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\corepack-shims\pnpm.CMD`; the same for `AppData\Local\node\corepack` (cache) and `AppData\Local\pnpm*`. A process created outside the app (WMI, the user's own terminal) does not find `pnpm` there, and the shim's relative path to corepack is wrong at its real address.

**How to apply:** outside the app, run pnpm as `node "C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js"` with `COREPACK_HOME` pointed at the LocalCache corepack folder; scripts/demo-detached.ps1 already does this. `supabase` is only a devDependency (node_modules/.bin), not a global command; `ngrok` is a real install under WindowsApps. Related: [[claude-app-process-tree-kills-servers]].

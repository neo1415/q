---
name: claude-app-process-tree-kills-servers
description: "Long-running dev servers started from Claude's shells die when the Claude desktop app restarts or updates; start them detached via WMI (scripts/demo-detached.ps1)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 782a5694-29f2-46aa-acde-6c8d24e943d9
  modified: 2026-09-17T11:34:21.734Z
---

Twice (2026-09-16 and 2026-09-17 10:24) the Capital Q demo stack "died for no reason": the Windows event log showed the Claude desktop app updating itself at the exact second the demo log stopped. Anything started from my Bash/PowerShell tools (even with Start-Process) lives in the app's job object.

**Why:** a job object closing kills every process in it; nothing in the app's logs says so.

**How to apply:** start the stack with `pnpm demo:detached -- --local` (scripts/demo-detached.ps1 uses Win32_Process.Create, whose child is WmiPrvSE, outside any job) and stop it with `pnpm demo:stop`. Tell the user to run `pnpm demo` from their own terminal for demos. See [[claude-app-msix-virtualised-appdata]] and [[turbo-strict-env-drops-overrides]].

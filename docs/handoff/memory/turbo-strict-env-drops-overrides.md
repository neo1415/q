---
name: turbo-strict-env-drops-overrides
description: turbo run dev in strict env mode silently drops shell env overrides (e.g. DATABASE_URL) unless turbo.json declares them; the dev task now uses envMode loose
metadata: 
  node_type: memory
  type: project
  originSessionId: 782a5694-29f2-46aa-acde-6c8d24e943d9
  modified: 2026-09-17T11:34:34.963Z
---

`pnpm dev` is `turbo run dev`. Turbo 2's default strict env mode hands each task only the variables turbo.json declares, so an override exported by a parent process (what `pnpm demo --local` does for SUPABASE_URL, DATABASE_URL, NEXT_PUBLIC_*) never reached the services, which then read `.env.local` instead. Symptom on 2026-09-17: q-api died with CONNECT_TIMEOUT to the hosted DB host while the launcher had printed "using the local Supabase stack".

**How to apply:** the dev task in turbo.json has `"envMode": "loose"` (fixed 2026-09-17). If a new task must see shell overrides, declare them or set the same. Related: [[claude-app-process-tree-kills-servers]].

---
name: qx-003a-hydration-fix
description: CQ-Q-BLOCKS-HISTORY-001 was two faults — a vestigial Suspense boundary and an open-guard set before the read it guarded
metadata:
  type: project
---

Closed 2026-09-21 at commit `a79c44d`. `/home?c=<id>` restored no turns and
no cards, with a successful read and no error anywhere.

Two independent faults, each sufficient alone:

1. `useQConversation` set `opened.current = wanted` *before* the async read,
   and its cleanup did not take it back. An effect cleaned up before its read
   landed left the mark behind; the next invocation saw "already open" and
   returned early, so the read never happened. React's dev double-invoke
   produces this reliably — so does any remount, in any build.
2. Home's Q surface sat inside a `<Suspense>` left over from when the panel
   used `useSearchParams`. See [[react-suspense-raf-reveal]] — this is why
   the bug looked like hydrated history being destroyed.

**How to apply:** a guard ref committed before cancellable async work must be
restored in the cleanup when the work was abandoned. And check
`visibilityState` before believing an empty render in the browser pane.

Preview caveat: `pnpm preview:update` runs `supabase db reset` on the preview
project, and `supabase/seed.sql` creates no `auth.users`, so every preview
update signs the tester out and leaves no account to sign back into.

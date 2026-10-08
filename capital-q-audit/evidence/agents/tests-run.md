# Evidence: targeted unit tests run 2026-10-08 13:11 UTC (provider keys set to disabled values)

```
npx vitest run packages/q-orchestrator/test/workforce.test.ts apps/q-api/test/workforce-job.test.ts apps/q-api/test/instruction-engine.test.ts
 ✓ apps/q-api/test/workforce-job.test.ts (4 tests)
 ✓ packages/q-orchestrator/test/workforce.test.ts (11 tests)
 ✓ apps/q-api/test/instruction-engine.test.ts (66 tests)
 Test Files  3 passed (3); Tests 81 passed (81)
```

Note: apps/q-api/test/workforce-job.test.ts plans MANDATE_WATCHER, CONVERSATION, SCHEDULER, AD_HOC, RESEARCH steps (lines 76-108) -- never WRITER/REVIEWER -- so the blocking path in repro-writer-step.md is untested. apps/web/test/work-decisions.test.tsx:218 uses actionType 'chat.message.send' only, never 'app.chat.message.send'.

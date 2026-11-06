# Receipt — instructions "activates once per approval" integration failure (2026-11-06)

Branch `fix/instructions-approval-test`, from `origin/fix/resume-asking-cv9ru3` (`4dbace9`).

## Cause

The test is stale; the product behaviour is not wrong. The outer `Rollback` assertion failed because an
assertion inside the transaction threw first:

```
expect(facts.instructionNews).toContain("1 thing needs your yes")
received: "1 thing is waiting for your yes. Want to go through it?"
```

`createOpenerFacts` (`apps/q-api/src/voice/returning-opener.ts`) now builds the opener with
`narrationOf` (`apps/q-api/src/composition/instructions/digest.ts`) from step counts and the number of
unread NEEDS_YOU notices. It deliberately never echoes notice or goal text (Zino live 2026-10-07). The
test still expected the notice title to be echoed back.

## Approval binding: checked, not affected

Every approval assertion comes before the stale line, and every one passed on the first run:

- a replayed approval (same `qActionId`) returns the same instruction, version 1;
- one instruction is listed;
- the grant `payload_hash` equals `grantHash(grant)`;
- another user cannot activate, read or stop the instruction;
- a changed grant becomes version 2;
- grants are append-only.

The transaction always rolls back, so nothing persisted. After the fix, the assertions that the
stale line had hidden also run and pass:

- stop works only once;
- steps are recorded once per idempotency key;
- the per-counterpart message cap is counted correctly;
- a stopped instruction gives no wake.

## Fix

The assertion now matches the current contract **exactly** (`toBe` instead of `toContain`, so it is
stricter than before). No product code changed.

## CI coverage

CI's `test` job runs `pnpm test` (root `vitest.config.ts`). That config excludes `**/*.integration.test.ts`,
and no workflow runs `pnpm test:integration`. So this file, like every `*.integration.test.ts`, never runs
in CI, which is why the drift went unnoticed. The only database job in CI is pgTAP (`supabase test db`).
A follow-up could add an integration job against the local-pg setup; that is not done here.

## Evidence (local PG `postgresql://postgres@127.0.0.1:54329/cq`, provider keys disabled)

- Reproduced: 1 failed, 2 passed. After the fix: `instructions.integration.test.ts` has 3 of 3 passing.
- `turbo build --filter=./packages/*`: OK.
- Root tsc: 0 errors.
- `apps/q-api` tsc: 0 errors.
- eslint on the file: clean.
- prettier: clean.
- vitest `instruction-digest` + `returning-opener*`: 14 of 14 passing.

Production was not affected: the change is test-only, with no live calls, deploys, hosted DB access or migrations.

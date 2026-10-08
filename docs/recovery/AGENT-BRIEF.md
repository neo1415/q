# Brief for every recovery workstream agent

Read these first, in order:
1. `CLAUDE.md`
2. `docs/recovery/SPEC.md` (your ownership row, the contracts in §3, the non-negotiables in §4, the acceptance criteria in §5)
3. `capital-q-audit/00-START-HERE.md`, then the audit files your workstream cites
4. `docs/recovery/TRACKING.md` (your rows)

## Setup (you are in your own git worktree)
```bash
pnpm install --frozen-lockfile
export TURBO_CACHE_DIR=/home/user/q/.turbo/cache   # shared cache: unchanged packages build instantly
pnpm turbo run build --filter="./packages/*"
```
Export these to every provider key you might touch, set to a **non-empty disabled value**: `OPENAI_API_KEY=disabled-locally-000000000000` (likewise for Gemini, Groq, ElevenLabs and Deepgram). No live provider calls. No writes to the hosted database. Read-only aggregate reads through `node scripts/handoff/live/hosted-read.mjs` are allowed, but never copy row contents into files.

## Phases
1. **Spec and research (first commit).** Write `docs/recovery/specs/<LETTER>-<name>.md`:
   - research (cite sources: official docs and code paths);
   - the current behaviour, with `path:line`;
   - the design;
   - the exact files you'll change;
   - contracts you need from the lead;
   - tests;
   - risks;
   - an acceptance checklist mapped to SPEC §5 and to your TRACKING rows.
   Commit it, then push to `build/rec-<letter>` (`git push -u origin HEAD:build/rec-<letter>`).
2. **Implement**, in small verified steps. After each meaningful step: run the targeted tests, commit, and push to `build/rec-<letter>`.
3. **Verify.** Unit and integration tests for what you changed. Typecheck the packages and apps you touched (`npx tsc --noEmit -p <dir>`). Run eslint on changed files only. Run prettier on changed files.
4. **Report** to the lead in 60 lines or fewer:
   - the commits;
   - what is DONE vs PARTIAL vs BLOCKED, with evidence (test names and counts);
   - requests for the lead (shared contracts, files outside your ownership);
   - risks.

## Rules
- Edit only the paths your workstream owns (SPEC §2). If you need a change elsewhere, put it in your report as a request. For tiny, unavoidable compile fixes in other files, keep them minimal and list them.
- Lead contracts (SPEC §3) are frozen. Add your own types in your own files.
- **Machine limits:** 4 CPUs are shared with 6 other agents. No full-repo `pnpm build`, `pnpm test`, `pnpm lint` or `next build`. Run only targeted `npx vitest run <paths>` and per-project `tsc`. Never start the dev servers unless your workstream is G.
- Never weaken tests, lint or types. Never add `ignoreBuildErrors`. No skipped tests.
- Never push to `recovery/2026-09-12` (production) or `recovery/2026-09-12-8y2j4w` (the lead's integration branch). Never deploy. No migrations applied to hosted.
- No fake progress, success claims or data. If something can't be done, say exactly what blocks it.
- Comments explain *why* (the house style). Match the surrounding code.
- Commit message trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SKDdLm192JxdqhuBZMfuCF
  ```

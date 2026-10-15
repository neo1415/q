# How to switch between Claude Code and Codex without losing the engineering work

## Initial setup — once

1. Add the files from this pack to the **same Capital Q repository**. Merge, do not replace, any root `AGENTS.md` already in the working tree.
2. **Keep the existing root `CLAUDE.md` intact.** Add a small ordinary text line near its introduction so Claude reads the shared file automatically:

   `Cross-model engineering handoff: @docs/ai-handoff/START-HERE.md`

3. Commit and push the new handoff files to the active integration branch. No model's chat session is necessary to understand them afterward.
4. Keep sensitive values in each environment's secret manager, not in Git. Other accounts/machines must be authorized and configured independently for database, GitHub and Railway access.

## When departing any model/session

Ask: "Checkpoint for cross-model handoff now. Update `docs/ai-handoff/{STATE,ACTIVE-TASKS,HANDOFF-LOG}.md` with exact commits, tests, deployed state and next executable actions. Commit and push. Do not claim live verification without evidence. Then give me one short resume instruction."

Before leaving, verify `git status --short --branch`, `git log -1 --oneline`, and which HEAD is pushed. If there are uncommitted changes that cannot safely be committed, explicitly list them in the handoff.

## When entering another model/session

Use the startup prompt in `START-HERE.md`. It must run Git checks and select work that is NOT already finished.

Claude Code account switch (official current UX): `/logout`, then restart/login using `/login` or `claude` in the terminal and choose the subscribed account. Confirm subscription in `/status`; an `ANTHROPIC_API_KEY` environment variable may take precedence and incur separate API charges. If `/login` is unavailable, follow the account-selection prompt of current Claude Code.

Codex: open the _same checked-out Capital Q folder_ with Codex CLI/app, sign in with ChatGPT Plus, select the available model and settings, and provide the startup prompt. Codex reads repo `AGENTS.md`; Claude Code reads root `CLAUDE.md` (with the handoff import). Check the current usage dashboard instead of assuming unlimited Astra.

## Concurrent work

**Sequential switching:** one workspace is easiest; never let an earlier session continue editing behind the new one.

**True parallel:** one Git worktree and branch per coding agent, separate test/runtime ports and clean merges. Example from repo root:

```powershell
git fetch origin
git worktree add ..\q-codex -b codex/agent-studio origin/build/int-rc
```

Do not run the two tools against the same files/branch simultaneously. Before merging, examine diff and conflicts, run targeted gates, and update the handoff.

## Important limits of this system

- A Markdown file does NOT transfer Claude or Codex hidden reasoning or actual chat history.
- It DOES transfer durable decisions, code edits, tests, task state and reproducible context.
- Model-specific tools/skills and locally stored environment credentials may differ. Translate instructions carefully; only source-controlled logic is inherently portable.
- Subscription allowances remain provider/account specific.
- A ZIP placed in a ChatGPT download folder is not automatically in your source tree; extract and commit it first.

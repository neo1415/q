---
title: Cloud cost playbook ($250 total, deadline Monday 2026-09-28)
project: capital-q
date: 2026-09-26
tags: [budget, cloud, claude-code, cost]
---

# Cloud cost playbook: $250 total, deadline Monday morning

**Rule:** the founder funds this personally. The **only hard ceiling is $250 total**. There is **no daily cap**: never stop, pause or slow the must-haves because of a daily figure. The deadline is fixed: **done, polished and deployed by Monday 2026-09-28 morning**, and the founder is unavailable all of Sunday. So work runs continuously and decides without waiting for answers. Everything below is about getting maximum product per dollar, not about spending less for its own sake.

## 0. Monday definition of done (priority order: finish higher items first)

Status labels matter: say NOT STARTED / PARTLY BUILT / DONE-NOT-DEPLOYED / LIVE.

1. **Voice speaks smoothly** (R22): no stutter, answers aloud every time.
2. **Q can do anything the app can** (R20 capability registry): profile edits, the Q Card, navigation, documents, all by voice and text. **Q knows the screen** (R21).
3. **Investor research-first onboarding** (BIZ-009, R13): Q first researches the investor from public sources (website, declared links; Companies House/SEC only if the founder supplies the key/contact), pre-builds the profile and mandate as recommendations with provenance, the investor confirms, and onboarding finishes much faster. Founder presence research already exists: align with it.
4. **Minimal Home Q page and product UI** (R23, R24):
   - collapsed side bars;
   - Q presence visible without scrolling;
   - Board opens only on its icon or when a file is made, and files open in a big modal;
   - no evidence or truth-label clutter in chats;
   - theme dropdown icon; voice options behind an icon; mute and end inside the input; scope chip moved out of the input.
5. **Seeded world** (R29, R19): about 12 fictional companies with stories, decks AND narrated deck videos published as pitches; about 8 investors. Discover shows them full height, centred, with icon actions.
6. **Profile shows everything from onboarding** (R25); **Settings page** (R28); **Relationships page** (R27).
7. **Q Card and public /@handle page redesign** (R26); founder Pitch & media page (VID).
8. **Journey audit fixes** (R30) for founder and investor, end to end on the deployed site.
9. **Integrations, chat and proactive Q (R32-R38)**: BIZ-007 Gmail approve-send and reply tracking, BIZ-008 reminders and Calendar/Meet (credentials are ready); R34 relationship chat (realtime, uploads, voice notes, Q on invoke, reminders and meetings from chat); R35 proactive login briefing plus the multi-question continuation bug; R36 better artifact and media viewers; R37 UX writing; R38 quiet web search. Each capability gets its page AND its registry entry (R33).
10. **Whole-product audit and enrichment (founder, 2026-09-27)**, run once items 1-8 are in, and again before Monday:

- **Spec audit:** re-read the PADL, the Product Specification, the Final System Review and the MVP/V1 definition (docs/product-sources, docs/architecture/10). List every promised MVP capability and mark it LIVE / PARTLY / MISSING on the deployed site. Build the missing ones that fit.
- **Connectivity audit:** every screen is reachable from navigation and from Q; no button, link or empty state is a dead end; every app action works by UI, typed Q and voice (R20 registry test); founder and investor journeys work end to end.
- **UI completeness:** every page is fully designed in light and dark at desktop and phone width, with no placeholder or unstyled screens. Use the project UI/UX skills in .claude/skills (frontend-design, emil-design-eng, accessibility, web-quality-audit, core-web-vitals).
- **Enrichment research:** study how top products in adjacent spaces handle the same journeys (investor deal flow, founder fundraising, AI assistants). Adopt the improvements that fit the locked specs; conflicts get an ADR proposal, never a silent redesign.

11. Then, in order: BIZ-005 brand kit, BIZ-006 /ops console, UX-01 instant shell.

After all of the above: R39 almighty, personal Q (sub-agents, deep research), then R41 (Q intelligence polish and exhaustive testing). Dropped: nearby-video speaker filtering.

If the $250 total starts running short, drop from the bottom of this list, never the top. Deploy each item as it lands, so Monday shows the best achievable product even if something at the bottom is unfinished.

Every number and setting below was checked on 2026-09-26 against the official docs (links in the last section). The founder's provider API credits (OpenAI, Gemini, ElevenLabs, Deepgram, Cloudflare Stream, Bright Data) are covered separately in CLAUDE.md: tests never touch them.

## 1. Where the money actually goes

Prices per million tokens:

| Model     | Input | 5-min cache write | 1-hour cache write | Cache read        | Output |
| --------- | ----- | ----------------- | ------------------ | ----------------- | ------ |
| Opus 5.5  | $4    | $5                | $8                 | **$0.20** (0.05×) | $20    |
| Sonnet 5  | $2    | $2.50             | $4                 | $0.20             | $10    |
| Haiku 4.5 | $1    | $1.25             | $2                 | $0.10             | $5     |

Claude Code re-sends the whole conversation on **every** request, and each tool call is another request.

- A worker at 150k tokens of context pays about 150k × $0.20/M = **$0.03 per tool call** in cache reads. That is fine while the cache is warm.
- A **cache miss** re-writes the whole context: 150k × $5/M = **$0.75**, or $1.20 at the 1-hour rate. Misses are the silent budget killer.
- Output (code, reports, thinking) on Opus is $20/M. Long reports and needless re-explanations cost real money.

Opus 5.5 cache reads cost the same as Sonnet's, so the founder's "Opus 5.5 for every agent" rule costs about 2× only on output and uncached input, not on everything. **Keep Opus, and keep the cache warm and the context small.**

## 2. Set these first (cloud environment variables)

The founder adds these once in the cloud environment dialog (claude.ai/code → environment settings → Environment variables):

```
CLAUDE_CODE_PROMPT_CACHE_TTL=1h
CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=1h
BASH_DEFAULT_TIMEOUT_MS=600000
BASH_MAX_TIMEOUT_MS=1200000
```

Why each one:

- **Subagent 1-hour TTL is the biggest single lever for this repo.**
  - Subagents default to a **5-minute** cache even on a subscription, and main sessions drop to 5 minutes once usage credits are drawn.
  - Our workers routinely wait 8–15 minutes for a turbo build or test run. With a 5-minute TTL, every long build means a full cache re-write when the worker wakes: about $0.75 each at 150k tokens.
  - With 1 hour, the write costs about $1.20 once, then about $0.03 per read.
- **Main 1-hour TTL:** the lead idles while workers run. Same reasoning.
- **Bash timeouts:** fewer "command timed out, run it again" loops. Each retry re-sends the full context.
- **Do not put secrets in environment variables.** Anyone using the environment can read them. On Pro/Max plans, API keys go in the environment's **API credentials** (proxy-injected; the session never sees them).

## 3. The VM is small: size concurrency to it

A cloud session is **one VM with 4 vCPU, 16 GB RAM and 30 GB disk**, and its subagents share it.

- A turbo build, an eslint run (needs an 8 GB heap) and a Next production build together will thrash it. Thrashing means slow commands, timeouts and retries, and each retry costs a full context re-send.
- **At most 2 workers doing builds, tests or browser work at the same time.** Up to 2 more may work on reading or writing-only tasks (docs, contracts, reviews).
- eslint always runs alone.
- Idle sessions stop and the VM is reclaimed. **Commit and push to GitHub after every meaningful step**, or the work is lost.

## 4. Environment caching (don't pay to reinstall)

- A setup script that finishes in under ~5 minutes is snapshotted and reused for about 7 days. Resumed sessions never re-run it.
- Setup script: `pnpm install --frozen-lockfile`, `pip install graphifyy`, and pre-pull the Supabase Docker images (`npx supabase start` pulls them; a running database is not kept in the snapshot, so start it in the session).
- If the script exceeds 5 minutes, it isn't cached. Move the Docker pull into a SessionStart hook or the first worker task instead.
- Docker is available, so local Supabase works. Never point tests at the hosted database.

## 5. Habits that keep the cache warm

These come from the docs' list of actions that invalidate the cache.

- **Pick model and effort once, at session start.** Switching models means a full re-read. On Opus 5.5, changing effort keeps the cache, but avoid it anyway.
- **Never enable fast mode.** It is $8/$40 per million, and turning it on causes a cache miss.
- **Don't connect or remove MCP servers, enable plugins, or add bare-tool deny rules mid-session.**
- Editing CLAUDE.md mid-session is cache-safe but **does not apply** until `/clear`, `/compact` or a new session. Edit it, then let the next worker or session pick it up.
- **Resume a worker for the same packet** (SendMessage) instead of spawning a new one. A resumed run reads the cache the original warmed, if it's within the TTL.
- A **fork** inherits the parent's cache. A fresh subagent does not.
- Each git worktree is a separate cache scope (different directory). That is unavoidable for isolation, so keep worker prompts tight and don't hand workers huge pasted context.

## 6. Keep contexts small

Every token in context is re-paid on every tool call.

- **Lead:**
  - Run `/compact` at natural breaks: after each merge-and-deploy cycle, with focus instructions (current queue, open branches, pending decisions).
  - Compacting while the cache is warm is cheap. Compacting after a long idle is expensive.
  - For a truly new phase, `/clear` costs nothing: write the state to the ledger first.
- **Workers:** one packet per worker. When the packet is done, the worker ends. Don't keep feeding a 300k-token worker new unrelated packets; start a fresh, small one.
- **Tool output discipline** (the biggest avoidable growth):
  - Always `| tail -n 40` or grep build, test and lint output: `grep -E 'Test Files|Tests |FAIL|error'`.
  - Never cat a log file. Never paste full JSON responses; use `jq` or `node -e` to select fields.
  - Page through big files with offset/limit.
- **Batch shell work into one command** where steps don't depend on reading intermediate output. Fewer round trips means fewer full-context re-sends.
- **Navigate with graphify** (`graphify query "<q>" --budget 1500`, `graphify explain`, `graphify path`) before opening files. Read only the file ranges needed.
- **Never read `docs/handoff/transcripts/` end to end.** Grep it for a specific decision.

## 7. Output discipline (Opus output is $20/M)

- Worker final reports: at most about 60 lines. Facts, SHAs, exact check results. No restating the prompt.
- Lead messages to the founder: concise. No long recaps of unchanged state.
- No speculative code, no rewrites of working code, no giant generated fixtures unless the packet needs them.

## 8. Things that burn money: forbidden

- Polling loops with `sleep` inside tool calls, and `/loop` or scheduled tasks for watching things. Use background commands and wait for the completion notification.
- Re-running full `pnpm check` after tiny edits. Run targeted tests; full gates only before merging to `recovery/2026-09-12`.
- Rebuilding packages that nothing needs (see memory `no-unnecessary-builds`).
- Two agents on the same topic; re-spawning instead of resuming.
- Agent teams (about 7× tokens). Subagents only.
- Web search ($10 per 1,000 searches, plus result tokens) for things already in `docs/`. Use WebFetch on a known URL when research is truly needed.
- Workflows with large fan-outs. Keep to the medium size guideline, and only when the founder asks.
- Re-reading large files already read in this context; re-deriving decisions already in `decisions`, ledger or requirements.

## 9. Tracking spend

- Run `/usage` at session start, midday and before ending.
  - The Session block shows the estimated cost for this session. It resets on `/clear`, so note it before clearing.
  - The `Prompt cache (main)` line shows the hit rate and names the likely cause of the last miss.
  - On a plan with usage credits, the usage-credits row shows the month's spend against the limit. Hard cap: the founder can set a monthly spend limit at claude.ai → Settings → Usage.
- Log each check in `docs/handoff/research/ledger.md`: `YYYY-MM-DD HH:MM spend ~$X (day total ~$Y), cache hit Z%, workers N`.
- **Trending over** (spend on course to exceed $250 before the section 0 must-haves are done): first remove waste (cache misses, oversized contexts, duplicate runs, needless browser evidence), then drop items from the bottom of section 0. Keep workers on the top items running. Note it in the ledger for the founder.

## Sources (fetched 2026-09-26)

- https://code.claude.com/docs/en/costs.md — tracking, /usage, reducing token usage, why usage climbs, agent teams about 7×
- https://code.claude.com/docs/en/prompt-caching.md — invalidating actions, TTL buckets, `CLAUDE_CODE_PROMPT_CACHE_TTL`, `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`, subagent and fork caching, worktree cache scope
- https://code.claude.com/docs/en/cloud-environments.md — VM 4 vCPU / 16 GB / 30 GB, Docker, setup-script cache (under 5 min, about 7 days), env vars readable by all users, API credentials, Bash timeouts, idle VM reclaim
- https://platform.claude.com/docs/en/about-claude/pricing.md — model and cache prices above

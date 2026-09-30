---
title: Capital Q — current handover (read this first)
project: capital-q
updated: 2026-09-30 (kept current by the cloud lead after every step)
---

# Capital Q — current handover

This file is the **single current entry point**. It supersedes the state
sections of `CLOUD-START.md` and `HANDOFF-2026-09-25.md` (their rules and
tooling notes still apply). The chronological record is
`docs/handoff/research/ledger.md` (read its last ~80 lines). Binding rules are
in the repo-root `CLAUDE.md`.

## 1. Where things are

- Repo `neo1415/q`. Work branch `claude/rana-account-setup-8esh9e`; deploy
  branch `recovery/2026-09-12`. **Push both** (`git push origin
HEAD:claude/rana-account-setup-8esh9e HEAD:recovery/2026-09-12`). Railway
  project `Q` auto-deploys web, api, q-api and workers from recovery; a
  service whose watch paths did not change shows `SKIPPED`.
- Production web: `https://capital-qweb-production.up.railway.app`.
- Hosted Supabase project ref `vcohxiqsmnkzxnvawgri`; migrations applied: 94.
- Founder's own test account: `adetimilehin502@gmail.com` (founder "Priya
  Khandelwal", company Nixo). Zino Aviation account `adedaniel502@gmail.com`
  (password only from the founder, passed as an inline env var `ZP=...`,
  never written to a file).

## 2. Operating the environment (what works)

- Railway CLI: `export RAILWAY_API_TOKEN=$RAILWAY_TOKEN; unset RAILWAY_TOKEN`.
  Services are named `@capital-q/web`, `@capital-q/api`, `@capital-q/q-api`,
  `@capital-q/workers`.
  - Deploy status: `railway deployment list --service @capital-q/q-api`
    (the top row may be `SKIPPED`; look at the first non-skipped row).
  - Logs of the CURRENT deployment only: `railway logs --service
@capital-q/q-api -n 400 --json` (earlier deployments' logs are gone).
  - Supabase keys at runtime only: `railway variables --service
@capital-q/api --kv` → `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Never
    write them to a file.
- Hosted DB read (read-only SQL, Management API):
  `NODE_USE_ENV_PROXY=1 node scripts/handoff/live/hosted-read.mjs "select ..."`
  (needs `SUPABASE_ACCESS_TOKEN`; `MAX=80000` for longer output).
- Hosted migrations: `NODE_USE_ENV_PROXY=1 node
scripts/handoff/hosted-migrate-https.mjs --apply <version>
--founder-approved <version>` (additive only; standing founder approval).
- **Model timings and failures are in the DB**: `ai_ops.model_usage`
  (task_class, model_id, latency_ms, success, error_code, correlation_id per
  call). All dialogue runs on `gpt-5.6-luna` (model id
  `a2000000-0000-4000-8000-000000000009`). This is the best latency source.
- Onboarding transcripts: `onboarding.interview_turns` (role, text,
  step_key = the step Q was asking). `scripts/handoff/live/transcript.sh
<email>` prints one person's interview.
- Live test scripts (`scripts/handoff/live/`, Playwright; run with
  `NODE_PATH=$(pwd)/node_modules/.pnpm/playwright@1.62.1/node_modules`
  or fix the import to that path):
  - `mkuser.mjs <email> "<Display Name>" "<Organisation>"` creates a confirmed
    user as sign-up would (needs `SB_URL`, `SB_KEY`,
    `CQ_SEED_ACCOUNT_PASSWORD`).
  - `onboard-adaptive.mjs` (env `EMAIL`, `TURNS`, `WAIT`) signs in, starts the
    founder interview, reads Q's latest question from the DB and answers from
    a pattern table. Pattern ORDER matters (specific before general).
  - `home-q.mjs` (env `EMAIL`, `ASK`) asks Home Q one question and prints
    the page.
- Prompts are versioned: a new version file, the old one `DEPRECATED`,
  registry and index updated, then
  `CQ_REGENERATE_PROMPT_LOCK=1 npx vitest run packages/q-core/test/lock-regen.test.ts`.
  A prompt variable's schema has a max length (the interview's `turnNotes`
  is 1,500 chars): exceeding it makes the render throw and the turn fail
  silently in tests.

## 3. How onboarding works now (2026-09-30)

- Arrival: `/` and PWA → `/welcome` → Q asks raise or invest → the
  journey's interview (`/onboarding/founder|investor?talk=1`). `/home` is
  gated until done. Completion: founder → `/profile`, investor → `/discover`.
- Typed path: web → api `/v1/onboarding/sessions/:id/say` → q-api
  `/v1/q/interview/turn` → `apps/q-api/src/voice/interview-agent.ts`.
- Each turn:
  1. An **independent reader** (DELEGATION_READER v3, FAST_CLASSIFICATION)
     reads what the latest words state, decline, hand over, approve, and
     whether they are finishing. It now runs **in parallel with Q's first
     round**; a reply written before it is in is held and redone if the
     reading asks something of the turn.
  2. The **agent loop** (INTERVIEW_AGENT v12) calls tools (record_answers,
     recommend, accept, correct, confirm_and_finish, research links) and then
     writes the reply. Every write goes through
     `apps/q-api/src/voice/onboarding-port.ts`, which enforces: the quote
     is the person's words; the value is stated in them (figures in digits
     OR words; text read back and agreed to); a delegated or approved write
     needs the reader's say-so; confirmation steps need the reader's
     agreement, and once every required answer is in, one yes confirms all
     remaining reviews and completes.
  3. **Code-composed turn notes** tell the loop, every turn: the name typed
     at sign-up (confirm, never ask cold), research findings not yet said,
     optional questions not yet asked, optional questions passed over after
     two unanswered asks, and standing rules (never ask for a number in
     another form; ask which choice fits rather than a catch-all).
- Research: `createInvestorResearch` engine (used for founders too) runs
  detached on the firm or company name (sign-up name from the first turn),
  web + registries → FOUNDER/INVESTOR_RESEARCH_READER → quote-checked
  findings → held as recommendations with their source, offered to the
  person. Founder research also offers the company's own website when a
  page's host is named for the company.
- Deadlines: turn 18 s (voice route cuts at 20 s), first model attempt 6 s.
- Home Q knows who is asking (name, own company, website; whether they have
  a pitch deck) via `askerOf` in `apps/q-api/src/main.ts`.

## 4. Verified working live (production, this chat, with evidence)

Onboarding and Q conversation:

- New user lands on Q (`/welcome`), not Discover; `/home` gated until done;
  shell shows only "Continue with Q" until done (fictional founder.onboard1-4).
- Founder interview end to end → `/profile`; investor → `/discover`
  (founder.onboard3 "Kemi", investor.onboard1 "Folake").
- Sign-up company name confirmed ("Greenbox, right?"), not asked again
  (onboard5-8).
- Spoken numbers saved: "twelve people", "about five million dollars", "just
  one founder" (onboard5, onboard8).
- Role "I'm the founder" → Q asks "are you also the CEO…" (onboard5, 8).
- Optional questions (description, website, country, sectors, materials,
  functions, pilots, follow-up) asked; deck deferral accepted (onboard8).
- One "Yes, that's right" to the review completes setup (onboard8).
- Answers land on the company row: website, country, description, stage
  (Greenbox row, `core.companies`).
- Research on the sign-up name runs and its findings are offered with the
  source (onboard8; Priya's Nixo research found description and US).
- Small-talk rounds counted in `q_runtime.person_standing`; varied, human
  replies with laughter.
- Typed words are kept when the voice line never connects.
- Home Q: answers about the person's own company from the profile (the
  ASSESS path, fixed 073bf8e6); opens a named chat ("open my chat with young
  field agro", about 9 s).
- Documents: new or revised documents appear without refresh; deck/document
  colour changes (revision v3).
- Branded emails (sender "Capital Q", HTML frame).

Earlier sessions (see ledger for evidence): deck generation and PDF, Q Card,
public @handle page, profile edit by Q, relationships, errands, GateQ embed,
admin console, investor twin rehearsal, Discover voice next/pass/save.

## 5. Open items (priority order) — keep this list current

1. **Smart interview (founder direction 2026-09-30, IN PROGRESS):** research
   finishes before or during the first turns and Q **reads out everything
   it prefilled** for bulk confirm/correct/skip; a person can talk at length
   and Q extracts many answers from one monologue, confirming them together;
   **values outside a step's options are kept in the person's words**
   (e.g. a country not in the list), never forced into a catch-all.
2. **Real-entity test bench:** seed 3-4 real founders and 3-4 real
   investors (famous and obscure; tidy and chaotic public info) as test
   accounts with `@fictional.capitalq.local` emails, run adversarial
   interviews (monologues, corrections, sarcasm, wrong options, backtracking),
   fix what breaks. Clear them from the DB afterwards.
3. Founder role has no "Founder" option (definition change = new definition
   version + migration); until then Q asks which title fits.
4. After onboarding, pending research findings (e.g. Nixo's description and
   US) are not offered anywhere; Home Q should offer them once.
5. "Signals & verification" empty for new companies (nothing in onboarding
   feeds it).
6. Research can match a different company with the same name; pass the
   founder's name and known site to the search and the reader.
7. Deck offer on Home for founders without a deck: coded (10158049), not yet
   seen live.
8. Latency: turns ~4.5-6 s of model time; next gain is a faster dialogue
   route for NORMAL_DIALOGUE.
9. Email spam: the founder must verify a domain in Brevo (SPF/DKIM/DMARC)
   and set `SMTP_SENDER="Capital Q <q@domain>"`.
10. Earlier list: C18 Q Daily, backgrounds/scroll/minimalism audit, voice
    humanisation (#27), live checks for meetings/Gmail/Recall (#21, #34),
    LangGraph ADR, server-action mismatch safeguard.

## 6. Lessons learned (do not relearn these)

- Measure before guessing: `ai_ops.model_usage` answers "why is it slow"
  and "which call failed" without logs.
- Logs exist only for the current deployment; reproduce after deploying.
- A structured-output refusal now names the unexpected field
  (`(root):unrecognized_keys(field)`); a prompt version and the schema a
  caller validates with must move together (the specialist validated v13
  output with the v8 schema and failed every answer).
- A test harness that answers the wrong question looks like a product bug;
  read Q's question from the DB, keep patterns specific-first.
- The founder tests with voice: number words, "yes go ahead", long rambles,
  and answers to a different question than asked are the normal case.
- Budget: $250 Claude credit total; provider credits (OpenAI $5 top-up,
  Recall, Pexels, Bright Data) are the founder's — test sparingly.

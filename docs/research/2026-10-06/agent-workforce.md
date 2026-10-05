# Q as a workforce of agents (J1-J9)

Research agent M1, 2026-10-06. Feeds the lead Q and specialists (J1), reviewer loop (J2), learning (J3), spawning (J4), workforce UI (J5), billing (J6), no phrase lists (J7), guides wiring (J8), plan-and-execute (J9).

## 1. Summary for builders

- The proven pattern is **orchestrator-workers + evaluator-optimizer** (Anthropic, "Building effective agents"): a lead breaks a job into tasks it cannot predict in advance, delegates, synthesises; a separate evaluator grades against clear criteria and loops until it passes ([Simon Willison summary](https://simonwillison.net/2024/Dec/20/building-effective-agents), [Spring AI reference](https://docs.spring.io/spring-ai/reference/api/effective-agents.html)).
- Anthropic's research system: a lead agent writes a plan to memory, spawns subagents in parallel with **explicit objective, output format, tools and boundaries**; it beat a single agent by 90% on their eval, but used **~15x the tokens of chat**, and token spend explained ~80% of performance variance ([Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)). Lesson: multi-agent is for breadth-heavy, valuable jobs; budget it.
- Runtimes converge on the same primitives: **handoffs, guardrails, tracing, human approval as a first-class pause** (OpenAI Agents SDK) ([npm @openai/agents](https://www.npmjs.com/package/@openai/agents), [overview](https://claw.aguidetocloud.com/openai/agents-sdk/concepts/)); **interrupt + checkpointer + resume** (LangGraph, Postgres checkpointer for production) ([LangGraph HITL](https://dev.to/jamesbmour/interrupts-and-commands-in-langgraph-building-human-in-the-loop-workflows-4ngl)); **manager agent delegates and validates** (CrewAI hierarchical) ([CrewAI docs](https://docs.crewai.com/en/learn/hierarchical-process)).
- Commercial "AI workers": 11x Alice (identify → research → write → handle replies; humans define ICP, approve rules, monitor quality) ([11x docs](https://docs.11x.ai/help-center/get-started/what-is-11x)); Artisan Ava (default full autonomy, manual review optional) ([Artisan](https://www.artisan.co/blog/artisan-launches-ava-2-0-the-first-autonomous-ai-bdr-now-self-serve)); Lindy (triggers; per-integration "Always allow / Require approval / Don't offer") ([Lindy triggers](https://docs.lindy.ai/fundamentals/lindy-101/triggers), [Automation Atlas](https://automationatlas.io/guides/moxo-vs-lindy-2026/)); Relevance AI (teams of agents with hand-offs, escalations, approval workflows, one oversight place) ([Relevance AI workforce](https://relevanceai.com/blog/announcing-the-ai-workforce)).
- **Capital Q stays stricter than Artisan**: Prepare → Recommend → Human Approval → Execute for anything consequential, unless explicit scoped delegation (Lindy's per-tool "Always allow" is the right shape for delegation). Specialists are internal; users see **one Q** (CLAUDE.md: specialists never user-selectable, never peer-to-peer; never show internal agent names). The J5 workforce UI must therefore show **jobs and roles** ("Drafting", "Checking against your guide"), not a cast of named bots.

## 2. Recommended architecture (within locked rules)

```
User / trigger ──► Lead Q (planner)  ── plan (typed, persisted) ──►  Job board
                     │  spawns tasks with: objective, inputs (context-eligible only),
                     │  tools allowed, output schema, budget, deadline
                     ▼
     ┌───────────── Specialists (stateless runs via Model Gateway) ─────────────┐
     │ research · writer · reviewer/grader · outreach · conversation (replies)  │
     │ scheduler · documents · mandate watcher · data-room · deck coach · ...    │
     └───────────────────────────────────────────────────────────────────────────┘
                     │ results (typed, with evidence + truth class)
                     ▼
               Lead Q synthesises ─► Prepare consequential action (exact payload,
               idempotency key) ─► Recommend to human ─► Approve ─► Execute (job)
```

Rules that keep it inside CLAUDE.md:
1. **Hub and spoke only.** Specialists never call each other; the lead (orchestrator) routes. A "hand-off" is the lead creating the next task.
2. **Context Firewall per task**: the lead passes only context the acting user may see; tools are filtered per run (context-eligible tools only); retrieval authorised before model invocation.
3. **Model Gateway by task class** for every model call (planner, writer, grader, extractor...). No direct provider calls.
4. **Typed everything**: plan, task, result, grade are Zod contracts; tasks are JOBs (outbox), results are DOMAIN EVENTs where they change state, approvals are AUDIT.
5. **No LLM in ranking**; the mandate watcher uses the deterministic slate and only drafts the Express Interest for approval (or executes it under explicit delegation scope like "auto-express interest for Strong fit, High confidence, Seed fintech in Nigeria, max 3 per week").
6. **Memory writes through the Write Gate**: specialists propose facts; the deterministic gate decides.
7. **Durable runs**: state checkpointed in Postgres (LangGraph-style) so a job survives restarts (Render workers are reclaimed); resume by job id; idempotent steps.

### 2.1 Specialist roster (J1), each with inputs, outputs, authority

| Role (internal) | What it does | Output | Authority |
|---|---|---|---|
| Planner (lead Q) | Turns a request or trigger into a plan of tasks; re-plans on failure | `Plan{steps[], budget, approvals_needed[]}` | None beyond creating tasks |
| Research | Gathers facts from permitted sources (network data, data room within grant, web via bounded tool) | Findings with citations, truth class | Read only |
| Writer | Drafts messages, replies, summaries, memos, decks edits | Draft + rationale (not chain-of-thought) | None |
| Reviewer / grader | Grades a draft against rubric (house guide + personal guide + task brief) | `Grade{score per criterion, pass, feedback[]}` | Can block, cannot send |
| Outreach | Plans who to contact and when (founders → investors via GateQ; investors → companies) | Prepared outreach batch | Prepare only |
| Conversation | Reads incoming replies, classifies intent with a model (no phrase lists, J7), drafts the next reply | Classified intent + draft | Prepare only |
| Scheduler | Proposes times, drafts invites, confirmations, reminders | Prepared calendar actions | Prepare; execute under delegation |
| Documents | Finds requested documents in the data room (within grants) or generates them (one-pager, summary) | Document + sharing proposal | Prepare sharing; founder approves |
| Mandate watcher | Watches new slates for Strong fits; alerts; drafts Express Interest | Alert + prepared action | Prepare; execute only under scoped delegation |
| Deck coach | A6 coaching | Gap list, drafts | None |
| Diligence | Builds a diligence checklist and status per company | Checklist | None |

"Every job that can be done gets an agent" (J1) is achieved by **one generic worker + role definitions as versioned config** (prompt, tools, output schema, rubric, model class), not a codebase per agent. New roles are config, not code (J4).

### 2.2 Reviewer loop (J2)

- Rubric = **house guide** (Capital Q tone: warm start, no meeting ask in the first message, specific, short, no hype) + **personal guide** (the user's own style and rules) + **task brief** (what this message must achieve) + **hard checks** (deterministic: no private data of the other party, length bounds, correct names, links valid, no promise of returns).
- Grade per criterion 0-5 with a short reason; pass bar e.g. all hard checks pass AND every criterion ≥ 3 AND mean ≥ 4 (config).
- Below the bar: feedback goes to the writer; max **2 redrafts** (budget); if still failing, surface to the human with the grade ("I couldn't get this to your standard: it's still too long. Want to edit it?").
- Use a **different model or at least a different prompt/temperature** for the grader to reduce self-agreement; never the same run grading itself.
- Deterministic checks first (cheap), model grading second. CLAUDE.md: do not ask an LLM to judge what code can assert.
- Only a passing draft reaches the approval screen; the approval screen shows the grade summary.

### 2.3 Learning (J3), safely

Signals, in order of value: **edits** the human makes before approving (diff = strongest signal), **approve vs reject** with reason, **outcomes** (reply received, meeting booked, deal progressed; not opens/clicks), grader feedback history.

Mechanisms (no fine-tuning needed for MVP):
1. **Personal guide updates**: after N similar edits ("always removes 'I hope this finds you well'"), Q proposes a guide rule; the user approves; the guide is versioned. (Write Gate: model proposes, human approves.)
2. **Few-shot memory**: store approved final messages (per user, `personal_private`) as examples retrieved for similar tasks.
3. **Rubric calibration**: track grader pass vs human edit distance; if passing drafts still get heavy edits, raise the bar or adjust criteria.
4. **Eval set**: every rejected or heavily edited draft becomes an eval case (q-evals package) for the writer prompt.
No cross-user learning from private content; house-level improvements only from anonymised, aggregate signals.

### 2.4 Spawning (J4) and budgets

- The planner may create tasks for any role in the registry, including **parallel** research subtasks (Anthropic pattern), each with explicit objective, output schema, tools, boundaries.
- **Budgets** at three levels: per task (tokens, tool calls, wall time), per job (sum), per organisation per day (billing). The planner sees remaining budget; exceeding it pauses the job and asks the user.
- Depth limit (e.g. 2 levels) and fan-out limit (e.g. 5 parallel) to prevent runaway spawning.
- Parallel subagents cost ~15x chat tokens in Anthropic's data; use them for research and diligence, not for drafting one email.

### 2.5 Plan and execute any work (J9)

1. Planner writes a **visible plan** (3-8 steps, plain words) with which steps need approval.
2. User can edit or approve the plan (for long jobs) or Q starts at once (for short, non-consequential ones).
3. Steps run; each step result attaches to the plan; failures trigger re-plan with the error, max 2 re-plans then ask the user.
4. The job ends with a result card (C1) and receipts (what was done, what's waiting for approval).

### 2.6 No fixed phrase lists (J7)

Replace keyword lists with a **classifier task class** in the Model Gateway: input text + typed label set + definitions + few examples → `{label, confidence band, evidence span}`. Examples: reply intent (interested / not now / no / question / out of office / meeting request), sentiment of decline, document request detection. Keep deterministic fallbacks only for safety-critical patterns (e.g. "unsubscribe" legal compliance) and the wake words. Evaluate classifiers with labelled eval sets (q-evals), not with phrase lists.

### 2.7 Guides wired everywhere (J8)

- Every outward-message task loads, in this order: house guide → organisation guide (firm or company) → personal guide → relationship context (stage of relationship; e.g. no meeting ask in a first touch) → task brief.
- Guides are versioned documents; the draft records which guide versions were used; the grader grades against the same versions.
- "Q keeps room to think": the guide constrains style and conduct, not reasoning; the writer may propose a different approach and say why (shown as rationale, not raw reasoning).

## 3. Workforce UI (J5)

References: Devin shows a **Progress** view unifying actions, a **Planner** to-do list, and tool tabs (shell, browser, editor) ([Devin docs](https://docs.devin.ai/work-with-devin/devin-session-tools)); Manus offers **task replay** for transparency ([The Neuron](https://www.theneuron.ai/tools/manus/)); GitHub Actions shows jobs as a graph with steps, live logs and per-step status; Linear shows issues by status lanes with assignees; agent UX research recommends a **task board with owners, status, SLA and outcome** over chat transcripts ([Hatchworks](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/)).

Capital Q design ("Q at work"):
1. **Work page** (sidebar): lanes **Planned · Working · Needs you · Done**. Cards are jobs ("Follow up with 4 founders from last week's GateQ"). Each card: goal, progress (step 3 of 5), what it is doing now in plain words, cost so far (credits), started by (you / a schedule / a trigger), next approval.
2. **Job detail**: the plan as a checklist (GitHub Actions-style step list: queued, running, passed, failed, waiting) with each step's result expandable; **hand-offs** shown as step transitions ("Draft ready → Checking against your guide → Passed 4.6/5 → Waiting for your approval"); internal role names are replaced by verbs (CLAUDE.md: no internal agent names, no raw reasoning).
3. **Needs you** inbox: all approvals across jobs, each showing the exact payload (email text, recipients, time), the grade summary, and buttons Approve · Edit · Reject (edit → re-approve binds to the new payload).
4. **Scores**: grade per draft as a small row of criteria with pass marks; outcome stats per job type over time (reply rate, meetings), never vanity counts.
5. **Controls**: Pause, Stop, Change budget, Change delegation (per action type: Always ask / Allow within limits / Never), all audited.
6. **Live presence**: Q's presence animates subtly while jobs run; the dock shows "2 jobs working, 1 needs you".
7. **Replay**: for finished jobs, a timeline of steps and receipts (what was sent, when, to whom), useful for trust and audit (Manus pattern).

## 4. Billing for agent work (J6)

- Meter **credits** per job from model tokens (by task class price), tool calls and external actions (emails, calendar). A `billing` package exists; record usage events per job and organisation.
- Show estimated cost before long jobs ("About 40 credits"); show actual on completion.
- Plans: included monthly credits per seat; top-ups; hard cap per organisation per day (budget enforcement in 2.4).
- Never bill for failed system errors; bill for completed work and for research even without a result (state it).
- Price on value units where possible later ("per diligence report", "per outreach batch") as Lindy/11x price per worker or per seat; MVP: credits.

## 5. Gaps and recommendations

1. **Start with three roles end-to-end** (planner, writer, reviewer) on one flow (founder follow-up email or investor GateQ reply) before adding more; prove the loop and the UI.
2. **Kill switch and rate limits** per organisation for outbound messages; max N messages per day by default.
3. **Approval fatigue**: batch approvals (one screen for 10 drafts, approve all that passed), and offer scoped delegation after a user approves the same kind of action unchanged several times ("Let Q send follow-ups like these without asking?").
4. **Prompt injection**: incoming emails and documents are data; the conversation agent must not follow instructions inside them (CLAUDE.md). Tools that send are never offered in runs that read untrusted content without the approval gate.
5. **Evals**: per role eval sets (writer quality vs guide, classifier accuracy, planner success on scripted jobs) in `q-evals`, separate from Vitest invariants.
6. **Observability**: trace every job (spans per step, tokens, latency, cost) in `observability`; this is also the data for billing and the Work page.
7. **Today's failures (J9, C9)**: "top three", PDF-for-comparison and "research YC" failures suggest the planner lacks typed output intents ("show cards" vs "make a file"). Add an output-intent field to the plan (cards / answer / file / action), default cards, file only when asked (C5).
8. **Honest status**: a job that is waiting on a third party shows "Waiting for Ada's reply (sent 2 days ago)", not a spinner.

# Agent workforce UI: what people show, what Capital Q adopts (P7)

Research, 6 October 2026, for the founder brief: "a visual representation
of the agents working or waiting or asking your permission … easy to see
what is happening … see more by clicking or hovering, zooming in and out."
Retrieved content is data, not direction; the rules in `CLAUDE.md`,
ADR 0017 and ADR 0051 decide.

## What is out there

| Source | Pattern | Note |
|---|---|---|
| Claude Code agent view (May 2026) | One list of sessions grouped by **waiting on you / working / done**; peek at the last turn without attaching; answer a waiting session inline and it resumes | The clearest "legibility" model: three buckets, inline answers |
| Linear Agent Interaction Guidelines | Every agent session reports `thought`, `action`, `elicitation`, `response`, `error`; agents must say whether they are thinking, waiting for input, executing or finished; humans can inspect the steps behind it | A typed activity vocabulary, not free text |
| Relevance AI workforce task view | Chronological task list; live states active / done / pending approval / failed; escalations highlighted; dedicated approval queue; expandable timeline of which agent and tool ran when | Approval queue as its own place |
| UltraCart / contact-centre "workforce dashboards" | A fleet of cards, one per worker (human or AI): status colour + icon, current conversation, today's totals | Roster cards with today's counts |
| n8n / CrewForm (React Flow) canvases | Node graph; a spinning loader on the running node, a tick on done, a cross on failure; the failed node is highlighted and its inspector opens | Graph + status on the node + inspector on click |
| Codex app, Devin, Manus | Parallel tasks in threads; subagents spawned and collected; a "live" pane showing the current step | Lead-and-subagents hierarchy |
| X / TikTok / Instagram trend: Pixel Agents, PixelHQ, Claude Office Visualizer | Agents as pixel characters in an office: typing when writing, reading when searching, a raised hand when they need you; the main agent is "the boss", subagents "employees" | Went viral because state is readable from posture at a glance and it feels alive |
| Dribbble / launch-video aesthetic | Glowing node swarms, particles, neon hand-off beams, holographic dashboards | Banned by CLAUDE.md |

Sources: [Claude Code agent view](https://claude.com/blog/agent-view-in-claude-code),
[Linear agent interaction](https://linear.app/developers/agent-interaction),
[Linear AIG](https://linear.app/developers/aig.md),
[Relevance AI task view](https://relevanceai.com/docs/workforce/workforce-features/workforce-task-view),
[UltraCart workforce dashboard](https://docs.ultracart.com/customers-crm/workforce/dashboard),
[n8n nodes](https://docs.n8n.io/build/understand-workflows/workflow-components/work-with-nodes),
[CrewForm](https://peerpush.com/p/crewform),
[Codex subagents](https://developers.openai.com/codex/subagents.md),
[Pixel Agents](https://github.com/MichaelMa907/pixel-agents-codex),
[Claude Office Visualizer](https://www.everydev.ai/tools/claude-office-visualizer/llms.txt),
[MS AG-UI multi-agent demo](https://devblogs.microsoft.com/agent-framework/ag-ui-multi-agent-workflow-demo/).

## What makes agent work legible (the common core)

1. **A small, fixed state vocabulary**, the same word everywhere, each with
   its own shape and icon, never colour alone.
2. **"Needs you" is first and loudest**; everything else is calm.
3. **Hierarchy you can see**: the lead in the middle, specialists around it,
   hand-offs as lines that light only while something is being handed over.
4. **Peek, then open**: hover (or focus) shows the one-line "doing now",
   click opens the full log with the inline decision.
5. **Semantic zoom**: far out, dots and counts; mid, name and state; close,
   the current step and the reason.
6. **Alive, but by real state**: motion only where work is actually running
   (the viral pixel offices work because posture = state).

## Adopt

- Buckets **Needs you · In progress · Done** (already the Work tabs) plus
  **Team** (the canvas) and **Cost**.
- Nine-state vocabulary mapped from server records only: working, thinking
  (planning), waiting on a counterpart, asking permission, held (blocked)
  with reason, failed with reason, done, idle, paused (budget, working hours,
  by you). Each state: label + icon + ring style (solid, dashed, double,
  hatched) so it reads in forced colours and greyscale.
- A **calm org-chart canvas**: Lead Q at the centre, specialists on one ring,
  straight thin hand-off lines; the line to an agent working now carries a
  slow 1-dot travel (Motion, off under reduced motion).
- **Semantic zoom** with wheel/pinch/buttons/keyboard (+, −, 0), drag to pan,
  zoom clamped 0.6–1.8, "Fit" resets.
- **Hover/focus card** (doing now, job, since when, cost) and **click panel**
  (sheet on phone, side panel on desktop) with the run log and **Approve /
  Read draft inline**, bound to the exact draft text (Approval Engine).
- A **list twin** of the canvas (same data, same order) for screen readers
  and small phones; the canvas is never the only way in.
- "Posture" from the pixel offices, translated institutionally: the
  monogram tile tilts nothing; the ring and one small glyph change.

## Reject

- Swarm graphs, particles, neon beams, glowing nodes (glow is Q's only,
  ADR 0017 F2), robot or character avatars, pixel-art people, gamified
  XP/leaderboards, "agents chatting to each other" bubbles (specialists never
  talk peer to peer; CLAUDE.md), raw tool names or internal agent ids,
  invented progress percentages, physics layouts that move on their own.
- Polling the whole job set every second: the live view polls only while the
  tab is visible, slows when idle, backs off on failure, and keeps the last
  good data on screen with an honest "offline / updated n s ago" line.

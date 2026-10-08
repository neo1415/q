# Capital Q: architecture and failure audit (2026-10-08)

This is a read-only forensic audit of Capital Q at commit `520bd123` (branch `recovery/2026-09-12-8y2j4w`). It was produced by six parallel investigators plus a lead, and draws on:
- the code (with `path:line` evidence);
- aggregate-only reads of the hosted database;
- live production traces from 2026-10-08.

No code was changed during the audit, apart from the lead's earlier fixes of that day, which are listed in `21` and `_findings/RULES.md`. Nothing in this package contains secrets or production row contents.

## If you only read three files
1. `18-CHATGPT-HANDOVER.md`: a standalone briefing on how everything works and where it breaks.
2. `14-CONFIRMED-DEFECTS.md`: severity-ranked defects, each with evidence.
3. `16-CROSS-SYSTEM-FAILURE-MAP.md`: why it feels broken, traced across subsystem boundaries.

## Headline findings
- **"Q just listens and doesn't do anything" has concrete causes in the code:**
  - The realtime voice model answers some turns without Q (C-03).
  - Q stays silent on unclear speech and the voice model improvises (B-01).
  - Answers are lost around reconnects and interrupts (C-04, C-05, C-07).
  - There is no "Thinking" watchdog (C-06).
  - The arrival cards unmount the moment Q starts talking (E-01).
- **Voice sounds mechanical by instruction:** "say exactly this", "say faithfully", flattened lists, answers capped at 1,200 characters (C-17, C-02).
- **Agents don't reply to counterparts reliably:**
  - A lapsed approval card parks a thread forever (D-01).
  - Job plans include roles with no executor (D-02).
  - Live: an investor went about 21 hours without a reply.
- **"What needs my attention" was answered "nothing" while an investor waited (L-01).** A fix is deployed but not yet verified live.
- **Infrastructure:**
  - Q action events have failed since 26 September (A-01).
  - RLS is bypassed for all service traffic (A-02).
  - Key state lives in a single process's memory (A-05).
  - There is no CI on the deploy branch and no error monitoring (F-06, F-07).
  - Web content reaches the model as a system instruction (F-03).
- **A regression introduced by the lead session on 2026-10-08:** the `silent` flag breaks model-initiated `ask_q` on the duplex line (C-01).

## Package layout
| File | Contents |
|---|---|
| 01 | Repository inventory |
| 02 | System architecture |
| 03 | Q brain: orchestration, prompts, routing, tools |
| 04 | Voice system (highest priority) |
| 05 | Memory and context |
| 06 | Generative UI and result rendering |
| 07 | Work page and agents |
| 08 | Tools and integrations |
| 09 | AI providers and costs |
| 10 | Security and permissions |
| 11 | UI/UX architecture |
| 12 | Database and persistence |
| 13 | Tests and observability |
| 14 | Confirmed defects |
| 15 | Unverified risks |
| 16 | Cross-system failure map |
| 17 | Open questions |
| 18 | ChatGPT handover |
| 19 | Recommendation inputs (constraints, not designs) |
| 20 | Code evidence index |
| 21 | Execution traces (verified, reproduced, reconstructed) |
| 22 | Coverage matrix |
| `diagrams/` | Mermaid diagrams: system, text and voice lifecycles, routing, tools, memory, rendering, agents, Work state, voice errors, auth, data model, model routing |
| `evidence/` | Sanitized source excerpts with original paths and line numbers, by area |
| `_findings/` | Each investigator's raw findings, plus `RULES.md` (method and the live evidence) |
| `MANIFEST.md` | File inventory, hashes and exclusions |

Defect ID prefixes: A (architecture), B (brain), C (voice), D (agents), E (UI), F (providers, security, tests), L (lead, from live traces).

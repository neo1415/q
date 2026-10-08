# Capital Q architecture audit — PARTIAL SNAPSHOT (2026-10-08)

This is an in-progress snapshot. Investigators for the Q brain/memory (03, 05), work/agents/tools (07, 08), architecture/database (01, 02, 12) and providers/security/tests (09, 10, 13) were still running when it was taken, so some of those files may be incomplete. Finished: 04 voice system, 06 generative UI, 11 UI/UX.

The full package will add 14–22 (confirmed defects, unverified risks, cross-system failure map, open questions, ChatGPT handover, recommendation inputs, evidence index, execution traces, coverage matrix) and a manifest.

- `_findings/<letter>.md` — each investigator's raw defects, risks, questions, evidence index and coverage.
- `diagrams/` — Mermaid diagrams.
- `evidence/` — sanitized source excerpts with original paths and line numbers.

Method: read-only inspection of the repository (branch recovery/2026-09-12-8y2j4w), aggregate-only reads of the hosted database, and today's live test calls (described in `_findings/RULES.md`). No secrets, no production row contents.

# Relationship Hub: research notes (adopt / reject / why)

Status: design phase, Lane B, 2026-10-14. Proposal only; no production code changed.
Scope: patterns from deal-flow and CRM products, judged against Capital Q's binding rules
(root `CLAUDE.md`, ADR-001, ADR 0017, `docs/design/ux-direction-2026-09.md`). We take
interaction patterns, not visual identities; nothing below copies a competitor's look.

Sources read on 2026-10-14 (vendor pages are marketing claims, not independent evidence):

- Affinity, deal flow management: <https://www.affinity.co/product/deal-flow-management-software>
- Attio data model (objects, lists, views): <https://attio.com/help/reference/attio-101/attios-data-model/define-your-data-model-objects-lists-and-views>
- Attio record pages: <https://attio.com/help/reference/managing-your-data/records/create-and-view-records>
- NN/g, progressive disclosure: <https://www.nngroup.com/articles/progressive-disclosure/>
- Linear display options and views: <https://linear.app/docs/display-options>
- Intapp DealCloud marketing pages (pipeline, relationship intelligence, transcripts): <https://www.intapp.com/blog/relationship-management-solutions/>
- OpenVC founder CRM (third-party listings): <https://www.stork.ai/en/openvc>

## Affinity

| Pattern                                                                  | Decision                      | Why, for Capital Q                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Activity captured automatically from email and calendar ("last contact") | Adopt (from existing sources) | We already record meetings, messages, requests and commitments as `relationship_events`. The Hub reads these instead of asking anyone to log activity.                               |
| An agent drafts field updates after a meeting; the team approves         | Adopt, through existing gates | This is our `Prepare → Recommend → Human Approval → Execute` path. Q proposes; the Write Gate persists, and only after approval of the exact payload.                                |
| Firm-defined stages and custom fields                                    | Reject (as free-form)         | Relationship state is a deterministic projection over events (`RELATIONSHIP_STATES_V2`). A firm may get display labels and saved views over it, never a second mutable stage column. |
| Relationship strength score ("88/100") and warm-intro paths              | Reject the score              | We forbid invented confidence numbers and "Top match" badges. We may say in words what is recorded ("3 meetings, last on 9 Oct").                                                    |
| Reporting by stage, source, owner, sector; time in stage                 | Adopt                         | Counts come from the existing Results read (`FounderResults` / `InvestorResults`) and its CSV and PDF report. Time in stage derives from event timestamps.                           |
| Per-deal permissions                                                     | Adopt (already the model)     | Visibility scopes come from ADR-001 and are enforced server-side and with RLS. The Hub shows each item's scope marker.                                                               |

## Attio

| Pattern                                                                                 | Decision              | Why                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objects, records and lists are separate; a **view** changes presentation, not data      | Adopt the distinction | This keeps the CRM an experience, not a database. A view is a saved filter, sort and column set over the canonical relationship read. It is never a copy of rows.                                                           |
| List entries with list-only attributes                                                  | Reject for V1         | List-only attributes would create a parallel deal record. If a firm needs private fields, they become typed, scoped notes on the canonical relationship (`organisation_private`).                                           |
| Saved views whose filter references "me" (one view, each person sees their own)         | Adopt                 | "My relationships" filters on owner = viewer and is resolved on the server from the session.                                                                                                                                |
| Table and Kanban for the same view                                                      | Adopt                 | The Pipeline toggles table and board. A board column is a derived state, so dragging between columns is **not** a state change. It opens the typed action ("Record meeting held", "Start diligence") that writes the event. |
| Record page: highlights, tabs (overview, activity, notes, tasks, calls, files), sidebar | Adopt the structure   | Our record has a header (identity, stage, owner, next action), a separate assessments strip and tabs. Attributes are not edited inline: facts carry provenance and change through the Write Gate.                           |
| Inline attribute edit history                                                           | Adopt as "History"    | Append-only data already keeps its history. The History tab shows events and revisions with actor type (HUMAN, Q, SYSTEM, CONNECTED_SYSTEM).                                                                                |

## NN/g progressive disclosure

| Guideline                                             | Decision | Application                                                                                                                                                                        |
| ----------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Put frequent needs first; keep the first screen short | Adopt    | Overview answers doc 17 §197: Where are we? What happened? What do they need? What happens next? Each area opens on a short list. Detail lives one click away.                     |
| At most two levels of disclosure                      | Adopt    | Level 1 is the Hub area. Level 2 is the record and its tabs. Evidence opens in a drawer over the record (doc 18 §188), which keeps the context and adds no third navigation level. |
| Clear, predictable labels for whatever reveals more   | Adopt    | We label actions by what they reveal, for example "Show 3 sources", "Open page 7" and "Jump to 14:32". We never use "More".                                                        |
| Avoid several routes to the same secondary content    | Adopt    | A record has one canonical URL (`/relationships/company/[id]` or `/relationships/investor/[id]`). Hub lists link to it and never embed a second copy.                              |
| Staged disclosure only for linear tasks               | Adopt    | Only Approval and Export are staged (review → confirm). Investigation is not staged.                                                                                               |

## Linear

| Pattern                                                                 | Decision | Why                                                                                                                                                          |
| ----------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Display options (layout, grouping, ordering) kept separate from filters | Adopt    | The Pipeline toolbar keeps them apart: filters change which relationships show, and display changes only how they show. People mix the two up less this way. |
| "My view" by default, "Set as default" for the team                     | Adopt    | A saved view belongs to the viewer. A team default needs organisation admin rights, which the server checks.                                                 |
| Keyboard switch between list and board; `/` to search                   | Adopt    | It is fast for power users. Every shortcut also has a visible control (WCAG 2.1.4).                                                                          |
| Quiet chrome that lets a few elements stand out                         | Adopt    | This matches "Q may glow; the product may not" (ux-direction §3). We do not take Linear's visual identity.                                                   |

## DealCloud (Intapp)

| Pattern                                                              | Decision               | Why                                                                                                                                                                        |
| -------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firm-wide pipeline across teams, sectors and geographies; tearsheets | Adopt (reports)        | The PDF report from `/results/report` is our tearsheet. A per-relationship export needs implementation (see review.md).                                                    |
| Meeting transcripts with AI summaries                                | Adopt, with provenance | Q's meeting notes exist (`QMeetingNotes`). Each summary line must link to a timestamped passage. Today the transcript has no timestamps, so a contract addition is needed. |
| "AI-generated signals" and recommendations in the pipeline           | Partly                 | Q may recommend a next action in words, backed by evidence. Ranking stays deterministic (no LLM in ranking), and a signal never changes a relationship's state.            |

## OpenVC (founder fundraising CRM)

| Pattern                                                | Decision                | Why                                                                                                                                                                     |
| ------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target list → outreach → pipeline → close in one place | Adopt (Fundraising Hub) | The founder's investors are the same canonical relationships from the other side. Capital rounds and commitments already exist (`capital/*`, `commitments.ts`).         |
| Deck view tracking ("they viewed slide 7 for 40 s")    | Reject                  | Viewing is not interest (CLAUDE.md). We show recorded, consented events such as "Northgate opened the deck v3". We do not show dwell time, and we never infer interest. |
| Founder-built investor database                        | Reject                  | Canonical investor organisations come from Capital Q. A founder never creates a parallel investor record.                                                               |

## What we take overall

1. **One canonical relationship, many views.** We adopt Attio's object/view split and reject list-only attributes.
2. **Derived stages; actions write events.** A board move is never a silent state write.
3. **Briefing first, investigation on request.** The fast, permission-filtered briefing is a read, and deep work is a Q Work job (progressive disclosure, two levels).
4. **Provenance on every claim.** Summaries link to transcript timestamps and document pages, and truth class, evidence status and lifecycle show as separate labels.
5. **No scores or engagement signals.** Relationship strength, dwell time and "hot" badges are all rejected.

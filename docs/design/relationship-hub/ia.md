# Relationship Hub: information architecture

Status: **design proposal** (Lane B, design phase only, 2026-10-14). No production code, navigation, Q orchestration, GateQ, schema or data changed. Every material change below is a proposal for product-owner approval. Precedence: locked PADL, then docs 17, 18 and 22, then ADR-001 and ADR 0017, then this document.

Prototype: `design/relationship-hub/` (run instructions in review.md).

## 1. What the Hub is

The Hub is the current **Results** page (`/results`) redesigned as a Q-native workspace over relationships. Investors see it as the **Investment Hub** and founders see it as the **Fundraising Hub**.

What it is not:

- It is not a new database. There is one canonical company, one canonical investor organisation and one canonical relationship (`UNIQUE (company_id, investor_organisation_id)`).
- It does not store a stage. Stage is the deterministic projection over `relationship_events` (`RELATIONSHIP_STATES_V2`).
- It is not a deal record. A saved view is a saved filter, sort and column set over the existing relationship read. It never copies rows.

Each Hub area answers doc 17 §197 at its own level: *Where are we? What happened? What do they need? What should happen next?*

## 2. Routes and navigation (no new global nav item)

### Existing pieces kept as they are

| Existing | Kept as |
| --- | --- |
| `/results` | The Hub. **Overview** is the default area, and query strings still read (`?range=`, `?from=&to=`, `?stage=`). |
| `/results/report?format=pdf\|csv&range=…` | Unchanged, under **Reports**. Same route handler and API (`RESULTS_REPORT_PATH`). |
| Sidebar "Results" entry (Workspace group, `navigation.ts`) | Same slot and href. Its label becomes **Investment Hub** or **Fundraising Hub** by side. No new top-level item is added. |
| Primary "Relationships" entry and `/relationships` | Kept. The index gains a link "Open in Hub → Pipeline". Merging the two is an open question (review.md §9). |
| `/relationships/company/[companyId]` and `/relationships/investor/[investorOrganisationId]` | **The relationship record.** It stays the one canonical URL per relationship. The calls, diligence and messages sub-routes stay. |
| `/gateq`, `/work`, `/work/[delegationId]` | Kept. The Hub embeds read-only summaries and links to them, and does not duplicate them. |

### Hub areas: one new route segment, additive

`/results/[area]` holds the areas. Overview stays at `/results`. Each area is a route, so Back, deep links, prefetching and Q's `NAVIGATE` behave like any page.

| Investor area | Route | Founder area | Route |
| --- | --- | --- | --- |
| Overview | `/results` | Overview | `/results` |
| Pipeline | `/results/pipeline` | Investors | `/results/investors` |
| GateQ | `/results/gateq` | Fundraising | `/results/fundraising` |
| Meetings & activity | `/results/activity` | Meetings & requests | `/results/requests` |
| Portfolio | `/results/portfolio` | Updates | `/results/updates` |
| Reports | `/results/reports` | Reports | `/results/reports` |

Rules:

- **Unknown areas.** An unknown area, or the other side's area (a founder opening `/results/pipeline`), redirects to `/results`.
- **Authorization.** The redirect is listed in `ROUTE_REDIRECTS` (app-routes.ts) so Q reports it honestly. The server still authorises every read.
- **Pipeline URL state.** The pipeline keeps its view state in the URL: `?view=table|board&saved=<id>&stage=IN_DILIGENCE&q=halden&cursor=…`. Pagination is by cursor, never offset.
- **Record tabs.** Tabs are `?tab=` on the existing record route, for example `/relationships/company/[id]?tab=evidence`. The existing calls, diligence and messages sub-routes stay valid.
- **Precise targets.** Two query parameters make Q's moves exact: `?doc=<artifactId>&page=7` opens the document viewer at a page, and `?meeting=<id>&t=22:05` opens a meeting at a transcript passage.

### Progressive disclosure: two levels

- **Level 1** is the Hub area, a short list or summary.
- **Level 2** is the relationship record and its tabs.

Evidence, documents and comparisons open as a **drawer or in-tab viewer** over the record (doc 18 §188), not as a third navigation level. On mobile the area tabs become a horizontal scroller, the record tabs scroll, tables become stacked rows (doc 18 §234), and Q becomes a bottom sheet.

## 3. Investor areas

1. **Overview.** It opens with the Q briefing: two or three sentences from the fast briefing layer, with a scope line saying "from records you are allowed to see". Below it:
   - the stage strip of derived counts (picking a stage opens the pipeline filtered);
   - **Needs you**: decisions, approvals and overdue requests;
   - **Coming up**;
   - **Recent activity**;
   - **Q's work**.
   Counts come from the Results read (`InvestorResults`).
2. **Pipeline.**
   - Layout: a table or board of the same relationships.
   - Saved views: *All active · My relationships · In diligence · From GateQ*, plus *Save view*. Views are per person; a team default needs organisation admin rights.
   - Toolbar: filters (stage, owner, sector, source, fit band) are kept separate from display options (layout, columns, sort), as Linear does.
   - Board moves: a column is a derived state, so a board move opens the typed action that writes the event (Start diligence, Record meeting held, Pause, Pass, Resume). It never writes a stage.
3. **GateQ.** The investor's GateQ inbox inside the workspace: applications with the rule check (`FITS · PARTIAL · NOT_A_FIT`, "5 of 7 rules met"), the dossier and the interview transcript. Actions are Connect, Reply and Pass, with Pass neutral, not red. This reuses `gateq/page/*` and `GateqInboxDto`. GateQ fit is a rule check; it never feeds recommendation ranking.
4. **Meetings & activity.** Meetings with their recording and consent state, plus a cross-relationship activity stream over `relationship_events` (cursor-paginated).
5. **Portfolio.** Relationships whose state is `INVESTED`: confirmed commitments, update due dates and the latest update received. Stated amounts are never shown as commitments.
6. **Reports.**
   - The existing Results PDF and CSV for a period.
   - A per-relationship export, which needs implementation. Organisation-private notes are included only by explicit choice.

## 4. Founder areas

1. **Overview.**
   - The Q briefing.
   - Investors by derived stage.
   - **Needs you**: requests, answers owed and updates to approve.
   - The round at a glance: confirmed and stated amounts, never summed.
   - **Q's recommendation**: source-backed, built only from what investors shared.
2. **Investors.** A pipeline over the same canonical relationships, from the company's side. Saved views: *All active · Need my reply · In diligence · Committed*. A founder never creates an investor record.
3. **Fundraising.** The round (`capital-rounds`), progress, and commitments split into *Confirmed* (both sides) and *Stated* (not a commitment). Built on `capital/*` and `commitments.ts`.
4. **Meetings & requests.** Diligence requests from every investor with due dates, meetings (with Q's prepare and propose-times actions) and the founder team's tasks.
5. **Updates.** Investor updates Q drafts from the founder's own documents. Every figure links to its source. The update needs approval of the exact text and recipients before it is sent.
6. **Reports.** The Results report, plus a per-investor export that never contains investor-private material.

## 5. The relationship record

There is one record, rendered for the viewer's side.

### Header

- Identity: name, sector, geography, stage and raise, or for an investor, type and cheque range.
- **Stage**: the derived state.
- **Owner**: the investor-side assignee, `organisation_private`.
- **Last activity** and the **event count**.
- **Next action**: from `RELATIONSHIP_NEXT_STEPS`, with the typed action button.

### Five separate readings, never one score

```
Mandate fit  ≠  Business evidence  ≠  Interest  ≠  Readiness  ≠  Outcome
```

Each reading is a word and, on Overview, its reason ("Stage outside range"). Other tabs show only the five words. There are no percentages, no meters and no "Top match". Unknown is written as "Unknown".

### Investor tabs

| Tab | Content | Builds on |
| --- | --- | --- |
| Overview | Record briefing, open items, latest meeting | `relationship-brief.ts`, `relationship-detail.tsx` |
| Intelligence & evidence | Material claims with truth class, evidence status and lifecycle as three separate labels. Contradictions are highlighted and both sources kept. Q's reading is labelled *Q inference*. A source-backed comparison is available. "What Q cannot see" states the firewall. | `q-knowledge`, `evidence`, `answer-cards`, `SHOW_COMPARISON` |
| GateQ dossier | The application as submitted (immutable), the rule standing and the interview transcript | `inbox-dossier.tsx`, `submitted-brief.tsx` |
| Meetings | Q notes (summary lines each linked to a timestamp), follow-ups, consent state and the transcript with jump-to-passage | `meeting-q.tsx`, `QMeetingAssistantDto` (**timestamps are new**) |
| Documents | Immutable versions: version picker, fingerprint, sharer and scope marker, and the page viewer | `documents.ts` (sha256), `data-room.ts`, `DOCUMENT_ACT` |
| Messages, notes & tasks | Messages (`relationship_shared`) shown apart from team notes and tasks (`organisation_private`), each with a scope marker | `relationship-conversation.tsx`, `GateqInboxNoteRequest` |
| Diligence | Requests, due dates, received, overdue and Q-suggested drafts | `relationship-diligence.tsx`, `DiligenceDto` |
| Q Work | Jobs and approvals for this relationship | `work/*`, `QWorkDto`, `QApprovalView` |
| History | Append-only events: sequence, time, type, actor type (HUMAN, Q, SYSTEM or CONNECTED_SYSTEM) and summary. Decisions are events here. | `relationship-timeline.tsx`, `RelationshipEventSummaryDto` |

### Founder tabs

Overview · Meetings · Requests · Shared documents · Messages · Q intelligence · History.

Above the content a standing line reads: *"You see what Northgate Partners shared with you. Their internal notes, deliberations and scores are private to them and never shown here."*

**Server-side rule (release-blocking).** Investor `organisation_private` and `investor_private` rows are excluded on the founder's read, enforced by the API and by RLS. Hiding them in the UI alone is not enough.

**No inferred interest.** Q intelligence on the founder side uses public sources and what the investor shared. It never infers interest from viewing ("They opened the model" is a recorded event, not intent).

### Export

Prepared as a job and delivered as a download. Organisation-private sections are opt-in, and a founder export never contains investor-private material.

## 6. The Q control model

The prototype demonstrates the existing contract (`packages/contracts/src/q/ui-act.ts`, `registry.ts`, `perform.ts`) and proposes a small extension.

### Stable semantic ids

Every control a person can use carries a stable semantic id whose first segment names its kind (`CONTROL_PREFIX`). Proposed ids:

| Group | Ids |
| --- | --- |
| Hub area tabs | `tab.hub-overview`, `tab.hub-pipeline`, `tab.hub-gateq`, `tab.hub-activity`, `tab.hub-portfolio`, `tab.hub-reports`, `tab.hub-investors`, `tab.hub-fundraising`, `tab.hub-requests`, `tab.hub-updates` |
| Saved views | `tab.view-<savedViewId>` |
| Pipeline | `input.pipeline-search`, `filter.stage-<state>`, `filter.owner`, `filter.source`, `toggle.pipeline-layout`, `list.pipeline` (with `count`), `item.pipeline-<n>` |
| Record tabs | `tab.record-overview`, `tab.record-evidence`, `tab.record-gateq`, `tab.record-meetings`, `tab.record-documents`, `tab.record-notes`, `tab.record-diligence`, `tab.record-work`, `tab.record-history` |
| Record content | `section.next-action`, `list.claims`, `item.claim-<n>`, `list.transcript`, `item.transcript-<mmss>`, `list.meeting-summary`, `section.document-page`, `menu.document-version`, `section.approval` |

### Typed, authorised acts

- **UI acts.** Every act is a `QUiActIntent` (`SELECT_TAB`, `FILTER`, `SELECT_ITEM`, `SCROLL_TO`, `FOCUS`, `OPEN`, `BACK`, …) or a typed intent (`NAVIGATE`, `OPEN_RECORD_PAGE`, `DOCUMENT_ACT GO_TO_PAGE`, `SHOW_COMPARISON`, `SHOW_EVIDENCE`).
- **Consequential actions.** UI acts never perform consequential actions such as Start diligence, Pass, Send or Share. Those are typed app actions with an authorise step and `Prepare → Recommend → Human Approval → Execute`, the approval bound to the exact payload, and an idempotency key.

### Four receipt states

The page performs the act and **reads the result back** from the control's own ARIA state, a route change or a visible element. Only then does it report the result.

```
requested     Q asked; nothing has happened yet
acknowledged  the page found the control and started the act
completed     the read-back matches (today's receipt status DONE)
failed        TARGET_MISSING · NOT_APPLICABLE · FAILED, with the reason in words
```

`QUiActReceipt` today has terminal statuses only. The proposal adds the `acknowledged` event as a non-terminal stream event, so the dock can show progress without inventing a Done (review.md §6). In the prototype, "Open the term sheet" fails with *TARGET_MISSING: no term sheet has been shared with you*, and nothing else opens in its place.

### Commands: existing versus needed

| Command | Status |
| --- | --- |
| Go to Results, Relationships, GateQ inbox or applications, Work tabs (`NAVIGATE` destinations) | **Exists** |
| Open a relationship record and its messages, calls or diligence tab (`OPEN_RECORD_PAGE` `RELATIONSHIP_*`, `Q_RELATIONSHIP_TABS`) | **Exists** |
| Open a GateQ application or a Work item (`GATEQ_APPLICATION`, `WORK_ITEM`) | **Exists** |
| Document next, previous or go to page, summarise, download (`DOCUMENT_ACT`) | **Exists** for documents in the viewer |
| Show comparison of 2 to 6 companies, show evidence (`SHOW_COMPARISON`, `SHOW_EVIDENCE`) | **Exists** |
| Generic UI acts on registered controls (select tab, filter, select item, scroll, focus, back) | **Exists** (registry and perform) |
| Navigate to a Hub area (`HUB_OVERVIEW`, `HUB_PIPELINE`, …) | **Needs** new `Q_NAVIGATE_DESTINATIONS` (additive) |
| Open record tabs evidence, documents, GateQ, Work, history, notes | **Needs** additions to `Q_RELATIONSHIP_TABS` |
| Set a pipeline filter, search or saved view by voice ("show my diligence deals") | **Needs** a Hub `FILTER` handler and `input` handling. Saved views need a typed id. |
| Jump to a transcript passage (`OPEN_MEETING_AT {meetingId, at}`) | **Needs** a new intent **and** timestamps in `QMeetingAssistantDto.transcript` |
| Open a data-room document at a page from a claim (`DATA_ROOM_DOCUMENT` + `page`) | **Partial**: the intent exists, and `page` on open needs adding |
| Acknowledged receipt event | **Needs** a stream event (see above) |
| Typed relationship actions from the board (Start diligence, Pause, Pass, Resume, Record meeting held) as Q-preparable actions | **Partial**: the routes exist (`deal-actions.ts`, `outcome-actions.ts`); a Q `prepare` wrapper is needed |
| Prepare relationship export | **Needs** a new job type |

## 7. Briefing layer versus deep investigation

These are two separate paths with separate budgets.

### Fast briefing

- **What it is.** A deterministic read over the permission-filtered relationship projection: events, open requests, next step, Results counts, plus a templated sentence or two.
- **Rules.** It runs **after** authorisation and before any model. It makes no tool calls and does no retrieval beyond the viewer's own scoped projection.
- **Model use.** An optional low-latency model may phrase the sentence, but only over already-filtered fields, through the Model Gateway.
- **Cost.** It is never on the critical render path. The Hub renders its counts first, and the briefing streams into a reserved slot (CLS 0).
- **Scope line.** It always shows one: "from records you are allowed to see".

### Deep investigation

- **What it is.** "Investigate further" or "Prepare a diligence brief" starts a **Q Work job** (`QWorkDto`). It has visible stages, only context-eligible tools and its own read scope, which is shown in "What this job may do".
- **What it can do without approval.** Nothing consequential. Its results are typed objects (brief, comparison, draft) that need approval before anything is sent or persisted, through the Write Gate.
- **What it shows.** Q shows stages, evidence, conclusion and uncertainty. It never shows raw reasoning or internal agent names.

### Firewall

Founder-private information never alters what an investor sees: not the ranking, not the briefing, not the wording. This is enforced at retrieval, at features and in the DB. The founder briefing never reads investor-private rows.

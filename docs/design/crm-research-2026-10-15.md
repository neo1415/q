# Capital Q CRM: research, capability map and design (2026-10-15)

Owner request (lane C, 2026-10-15): research what an investment CRM needs, for
investors and for founders, map each capability to what Capital Q already has,
then design how to present and arrange it. This is the source for the CRM
rebuild slices.

Controlling sources: CLAUDE.md invariants, ADR 0017, `docs/design/ux-direction-2026-09.md`,
docs 17-19. Where this document and they disagree, they win.

## 1. Research: what leading products do

Most sources are vendor marketing. I use them for what the products ship, not
for their performance claims.

### 1.1 Investor side (VC, PE, family office)

| Product                    | What it centres on                                                                                                                                                                                                                                  | Source                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Affinity                   | Relationship intelligence: a network map built from email and calendar, relationship-strength scores, warm-intro paths. Deals in a table or Kanban view (New, Reviewing, Due diligence), one-click stage updates, pipeline shared with GPs and LPs. | [Affinity, deal sourcing](https://affinity.co/product/deal-sourcing); [Affinity for VC](https://www.affinity.co/lp/venture-capital-lp); [CB Insights](https://www.cbinsights.com/investor/affinity)                                                                                                                                                       |
| Intapp DealCloud           | One configurable pipeline for inbound, proprietary and referred deals, with stage, value and probability. Diligence tasks, deliverables and **IC approvals** on the deal record. Live pipeline dashboards. Data feeds (PitchBook, Preqin).          | [Intapp DealCloud](https://www.intapp.com/?p=25084); [Alpha FMC](https://alternatives.alphafmc.com/technology/dealcloud/); [Capterra reviews](https://www.capterra.ca/software/139967/dealcloud)                                                                                                                                                          |
| Attio                      | Fast, keyboard-friendly tables and boards; custom objects (portfolio, LPs); deal flow with **partner vote and pass reasons**. No algorithmic relationship scoring.                                                                                  | [Attio for VC](https://attio.com/solution/venture-capital-crm-software); [craftt.io, Attio for VC](https://www.craftt.io/attio-for-vc); [craftt.io, Affinity vs Attio](https://www.craftt.io/blog/affinity-vs-attio)                                                                                                                                      |
| 4Degrees                   | Relationship-strength scoring across the team, parallel pipelines (deals, LP fundraising, portfolio monitoring) in Kanban or filtered views, alerts when contacts change jobs or appear in the news.                                                | [4Degrees VC/PE](https://4degrees.ai/vc-pe); [4Degrees CRM](https://4degrees.ai/crm/)                                                                                                                                                                                                                                                                     |
| Carta CRM                  | A fund-side system of record. Its Claude plugin answers "where do deals stand by stage", updates stages from chat, and produces meeting briefs with LP context.                                                                                     | [Carta + Claude CRM plugin](https://carta.com/explore/carta-claude/crm-plugin/)                                                                                                                                                                                                                                                                           |
| Visible / Standard Metrics | Portfolio monitoring: KPI requests to portfolio companies with reminders. Visible's core six are revenue, cash, net burn, runway, net income and headcount. Also LP reporting.                                                                      | [Visible, portfolio metrics](https://visible.vc/investor-blog/what-metrics-should-i-be-collecting-from-my-portfolio-companies); [Visible monitor](https://visible.vc/monitor); [Standard Metrics](https://standardmetrics.io/library/what-are-the-best-ai-portfolio-monitoring-tools-for-venture-capital-in-2026/)                                        |
| ILPA templates             | The LP reporting standard. A quarterly reporting template (updated 22 Jan 2025) and a Portfolio Company Template (revision due Jan 2027).                                                                                                           | [ILPA Portfolio Company Template](https://ilpa.org/industry-guidance/templates-standards-model-documents/ilpa-templates-hub/ilpa-portfolio-company-template/); [Paul Weiss on ILPA quarterly reporting](https://www.paulweiss.com/practices/transactional/investment-management/publications/ilpa-releases-best-practices-in-quarterly-reporting?id=8353) |

The usual deal stages are sourcing, screening, initial diligence, IC and term
sheet, negotiation and legal diligence, closing, then monitoring
([Carta, deal flow](https://carta.com/learn/private-funds/management/deal-flow/);
[Allied VC](https://www.allied.vc/guides/how-to-build-a-startup-deal-flow-pipeline)).
Referral-to-close conversion is often below 1%, so the pipeline's job is
triage quality, not volume
([Affinity, organising deal flow](https://www.affinity.co/blog/how-to-organize-your-deal-flow)).
IC practice rests on a memo template, a decision record, an approval trail and
a list of conditions
([Process Street](https://www.process.st/venture-capital-software/);
[Expando VC decision hub](https://help.expan.do/templates/vc-decision-hub-ic-and-memo-management-for-vcs)).

### 1.2 Founder side (fundraising)

| Product            | What it centres on                                                                                                                                                                                           | Source                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundersuite       | A Kanban investor pipeline shared with advisors, an investor database, an online deck with view tracking, and investor updates.                                                                              | [Foundersuite 2.0](https://www.producthunt.com/p/foundersuite/foundersuite-2-0); [GetApp](https://www.getapp.com/financial-crm-software/a/foundersuite-1)                                                                                                                                   |
| Visible (founders) | Investor database, pipelines (intro, meeting, follow-up, commitment), deck sharing with **per-slide analytics**, data rooms, monthly updates. In their data, decks of 12 slides or fewer got the most views. | [Visible fundraising](https://visible.vc/fundraising/); [Visible data rooms](https://visible.vc/blog/data-rooms-announcement); [Visible 2023 recap](https://astro.visible.vc/blog/2023-visible-for-founders-recap); [Visible, investor pipeline](https://visible.vc/blog/investor-pipeline) |
| DocSend            | Page-level time on each document; data-room analytics per space, with visit CSVs.                                                                                                                            | [Dropbox help, DocSend data room analytics](https://help.dropbox.com/organize/dropbox-docsend-data-room-analytics)                                                                                                                                                                          |
| YC guidance        | Raise fast. Prefer good investors over a high valuation; sell about 20%. Expect about three meetings per investor. Close a first tranche early. Warm intros are by far the best channel.                     | [YC, A Guide to Seed Fundraising](https://www.ycombinator.com/blog/how-to-raise-a-seed-round/); [YC, Fundraising Fundamentals](https://www.ycombinator.com/library/7I-fundraising-fundamentals-sus-2018)                                                                                    |

The founder pipeline is research, intro, first meeting, partner meeting,
diligence, committed, closed. The useful signals are who went quiet and for
how long, and what was read
([Metal, investor pipeline](https://www.metal.so/guides/how-to-organize-and-track-your-investor-pipeline-during-a-fundraise-in-2026/);
[Visible, investor pipeline](https://visible.vc/blog/investor-pipeline)).

### 1.3 Must-haves and nice-to-haves

**Must-have, both sides:** one record per counterpart; a stage pipeline as a
table and a board; next step and its due date on every row; reminders and
follow-ups; notes; a timeline of what happened; documents shared and
requested; search, filters and saved views; export (CSV/PDF); a period report.

**Must-have, investor:** pass reasons; diligence tracking (requests,
documents, open questions); an IC or decision record; a portfolio view after
close.

**Must-have, founder:** progress against the round (target, soft-committed,
committed, received); who went quiet; data-room and deck engagement; a
follow-up list.

**Nice-to-have:** relationship strength and warm intros (Affinity, 4Degrees);
contact-change alerts; KPI collection and LP reports (Visible, ILPA);
per-slide analytics; votes and IC minutes; Q briefs before a meeting.

**Leave out (CLAUDE.md):** engagement scores used for ranking, "hot" badges,
invented confidence percentages, view counts treated as interest ("viewing
is not interest"), pay-to-rank. A relationship-strength score made from
browsing would break "Viewing ≠ Interest" and "Declared ≠ Observed".

## 2. Capability map: what Capital Q already has

Legend: **Has**: shipped and reachable. **Hidden**: shipped but hard to find
or outside the CRM. **Partial**: some of it exists. **Gap**: missing.

| Capability                             | Capital Q today                                                                                                                                                      | State                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| One record per counterpart             | Canonical relationship `UNIQUE (company_id, investor_organisation_id)`; `/relationships/{company,investor}/[id]` (overview, messages, calls, diligence)              | Has                                            |
| Pipeline table and board               | `relationship-pipeline.tsx`: table and board, columns, saved views (`relationship-views.ts`), search, stage filter                                                   | Has                                            |
| Stage model                            | Relationship state (projector) plus the deal stage fold `deal-stage.v1`: Met, Diligence, Soft commit, Terms, Signed, Funds received, Closed (`deal-stage-strip.tsx`) | Has                                            |
| Next step, due dates                   | Next card on the record; "Next step" column on the Relationships list                                                                                                | Has                                            |
| Reminders and follow-ups               | `schedule.ts` reminders (create, dismiss); "Reminder due" on rows; notices                                                                                           | Has, scattered                                 |
| Timeline                               | `relationship-timeline.tsx` over relationship events                                                                                                                 | Has                                            |
| Notes                                  | Outcome or pass note (investor-private), diligence request notes, decline notes                                                                                      | Partial: no free-form private note on a record |
| Tasks                                  | Q errands for one relationship (`relationship-errands.tsx`), Q Work lanes for the counterpart (`RecordQWork`)                                                        | Has (Q-run); human to-dos are reminders        |
| Pass reasons                           | `relationship-outcome.tsx`, GateQ inbox pass reasons                                                                                                                 | Has                                            |
| Diligence tracking                     | Diligence tab: investor asks, founder uploads or shares, file rows with expiry and revoke, questions                                                                 | Has                                            |
| Data room and deck                     | Company page Data room and Pitch deck tabs; `/company/data-room` (founder)                                                                                           | Has (now reachable)                            |
| Data-room engagement                   | `viewedAt` on shares in the diligence read; "Apex viewed your company" notices                                                                                       | Partial: per document, not per page            |
| Fit and interest                       | `FitAndInterest` beside each other, never merged; fit line on rows                                                                                                   | Has                                            |
| GateQ (inbound applications)           | `/gateq` inbox (investor), applications (founder); GateQ slot on the record                                                                                          | Has, outside the CRM                           |
| Company requests (founder to investor) | `/investors` (investor)                                                                                                                                              | Has, outside the CRM                           |
| Round progress (founder)               | `/capital` rounds, commitments, readiness, plan                                                                                                                      | Has, outside the CRM                           |
| Period report and export               | CRM Overview: Results dashboard, PDF/CSV `/results/report`, deal download                                                                                            | Has                                            |
| Portfolio (investor)                   | Deal Closed and Funds received count in Results; "in your portfolio" line on the deal                                                                                | Partial: no portfolio list                     |
| IC or decision record                  | Commitment and outcome actions; Q's first-stage report on Q Work                                                                                                     | Partial: no IC memo or decision trail          |
| Meeting prep                           | Rehearsals per counterpart; Q briefs (`brief-lines.ts`); call records                                                                                                | Has                                            |
| Relationship strength, warm intros     | Network preview reads                                                                                                                                                | Gap (deliberate: see 1.3)                      |
| KPI collection, LP reports             | none                                                                                                                                                                 | Gap (V2)                                       |

The owner is right: almost everything exists. What is wrong is the
arrangement. The work is spread over five places (CRM, Capital, GateQ,
Company requests, the company page), and the CRM's front page does not say
**what needs me now**.

## 3. Design: how to arrange it

### 3.1 Principles (from the sources and our rules)

1. **Work queue first, dashboard second.** Affinity, DealCloud and Carta all
   open on "where deals stand". Our Overview leads with the few
   relationships that need the person, then the pipeline by stage, then the
   period.
2. **One list, two layouts.** Relationships and Pipeline are the same records
   (critique 2026-10-15). The rebuild makes **Pipeline** the one record
   list, with table and board layouts, saved views and the stage filter.
   "Relationships" (`?view=relationships`) redirects there with its filters.
3. **Inbound streams reach the person through the queue, not through more
   links.** GateQ applications, company requests and investor asks arrive
   as notices, so they appear in Needs you, each linking to its owning page.
   The owning pages stay where they are, so there is no parallel truth. A
   separate "Inbound" line was dropped in S1: it repeated the header's
   GateQ link and the sidebar.
4. **Evidence, never scores.** Fit is the band in words, interest is what
   happened, engagement is "viewed 2 days ago". No percentages, no heat.
5. **The record is the unit.** Every row opens the one relationship record.
   The record keeps its tabs (Overview, Messages, Calls, Diligence).
   Founders get "Edit data room & deck" there (shipped).

### 3.2 Information architecture

```
CRM  (/relationships)
├── Overview        needs-you queue · stage funnel · period report + exports
└── Pipeline        every relationship: table | board, saved views, search, stage, columns
    └── Record      /relationships/{company|investor}/[id]: overview · messages · calls · diligence
```

The tabs are Overview and Pipeline. `?view=relationships` and `/results` keep
working through redirects. Q's `tab.relationships` stays registered on the
Pipeline tab until the catalog moves (same id, no break).

### 3.3 Overview, top to bottom

1. **Needs you** (5 rows, then "See all"): unread notices folded to one row
   per relationship and kind (messages, diligence asks, interest, requests,
   Q work), plus reminders that are due. Each row names the counterpart,
   the reason in words and one action; the cross clears it. Empty: "Nothing
   needs you right now." Unreadable: said in place (partial). Shipped in
   S1. "Quiet for 14 days" rows are a later addition: they need a
   last-activity read the Overview does not make yet.
2. **Pipeline by stage**: the existing stage funnel (Results), each stage a
   link into Pipeline filtered by it.
3. **Period**: the existing stat strip, activity bars, period selector and
   PDF/CSV downloads.

### 3.4 States, for every block

| State             | Rule                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Loading           | Skeleton at the block's final size (CLS 0). Blocks stream on their own.                                 |
| Empty             | One sentence saying what will appear, plus the one action that starts it.                               |
| Error             | "Couldn't load" names the block, says nothing is lost, offers Try again. The other blocks still render. |
| Partial           | A block whose read failed says so in place; the page never pretends it is "none".                       |
| Permission denied | No organisation: Set up. Wrong side: unavailable, never the other side's view.                          |

### 3.5 Visual and interaction

Hairline rows on one surface; no metric-card grid; no badges. One `cq-title-lg`
heading. Tabular numerals for counts. Touch targets of at least 44px. Rows
are whole-row links with a visible focus ring. Motion only on hover and press
(colour, under 150ms), and no motion on load. Phone: the queue rows stack
(name, then reason, then action); the funnel becomes a stage list. Light and
dark both come from `--cq-*` tokens only.

## 4. Build slices

| Slice | Scope                                                                                                                                   | Tests                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| S1    | Overview "Needs you" queue from the existing notices and reminders reads, with all states; removed from the Relationships tab (shipped) | Unit: queue ranking, cap 5, empty and partial; page states |
| S2    | Pipeline as the one record list: `?view=relationships` redirects into it; Relationships tab retired; Q ids kept or catalogued           | Redirect and tab tests; parity                             |
| S3    | Private notes on a record (investor-private or founder-private, append-only, RLS)                                                       | Migration, RLS positive and cross-tenant negative, UI      |
| S4    | Investor portfolio list (closed and funded relationships) on Overview                                                                   | Read-model and UI                                          |
| S5    | Decision record: pass or commit with reason, conditions and who decided, from existing outcome and commitment events                    | Unit and UI                                                |

S3 to S5 add or extend data; S1 and S2 rearrange what exists. Ship S1 and S2
first.

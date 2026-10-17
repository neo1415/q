# Relationship Hub: design review

Status: **design proposal** (Lane B, design phase only, 2026-10-14). Branch `claude/relationship-hub-design`. No production app code, shared navigation, Q orchestration, GateQ, schema, migrations or live data changed. Material changes need product-owner approval.

Companion documents: [ia.md](ia.md) covers routes, areas, the record and the Q control model. [research.md](research.md) records what we adopt, what we reject and why.

## 1. Running the prototype

From the repo root, run:

```bash
python3 -m http.server 4321 --bind 127.0.0.1
# open http://127.0.0.1:4321/design/relationship-hub/index.html
```

How it is built:

- **Stack.** Plain HTML, CSS and JS, with no build step and no new dependency.
- **Tokens.** It links the real tokens file `packages/ui/src/tokens/tokens.css`, so it cannot drift from the app. Body text uses the app's system UI stack (`--cq-font-ui`); figures and ids use Geist Mono (OFL, copied from the installed `geist` package).
- **Deep links.** Use the form `#investor/record/halden/meetings?t=2205` or `#founder/updates`. Add `?theme=dark|light` before the hash to force a theme.
- **Switching role and theme.** The banner switches Investor and Founder view. The sidebar switches Light, Device and Dark.

Media (outside git): `/home/user/q/design-deliverables/relationship-hub/`.

- **Videos.** `1-investor-walkthrough.mp4` (90 s), `2-founder-walkthrough.mp4` (78 s, dark), `3-q-controls-workspace.mp4` (76 s), `4-mobile.mp4` (66 s, 430×932). H.264 MP4 alongside the WebM originals.
- **Screenshots.** The gallery is `screens/`: 19 screens × desktop and mobile × light and dark, 76 PNGs. A subset is committed in `docs/design/relationship-hub/screens/`.
- **Regenerating.** Run `design/relationship-hub/scripts/{shots,walkthroughs}.mjs`. They use Playwright from the main checkout and Chromium at `/opt/pw-browsers/chromium`.

## 2. Navigation structure

- **No new global item.** The sidebar's existing Results slot is relabelled by side (**Investment Hub** / **Fundraising Hub**) and keeps `href="/results"`.
- **Areas are routes.** They live under `/results/[area]`, and `/results/report` is unchanged. A person can share an area, go Back to it, and Q can `NAVIGATE` to it.
- **One record URL per relationship.** It stays `/relationships/{company|investor}/[id]`, and the Hub links to it. Pipeline rows, board tiles, Needs-you rows and Q all open that same page, so there is no second copy (NN/g: one route to each secondary display).
- **The primary Relationships entry stays** for now. Its index links into the Hub pipeline (open question 1).

## 3. Hierarchy

1. **The Hub area** (level 1) leads with the briefing, then what needs the person, then the full lists.
2. **The relationship record** (level 2) shows, in order:
   1. identity and **next action**;
   2. the five separate readings;
   3. the tabs.
   On tabs other than Overview, the readings shrink to their words, so the content stays above the fold.
3. **Evidence, documents and comparisons** open inside the record as a drawer, an in-tab viewer or an inline comparison, never as a third navigation level.
4. **Visual weight goes to decisions and next actions.** Counts are plain tabular numbers in hairline panels. There are no metric-card grids, badge spam, percentages or gauges. Labels always carry words, and colour only reinforces them.

## 4. Role differences

| | Investor (Investment Hub) | Founder (Fundraising Hub) |
| --- | --- | --- |
| Areas | Overview, Pipeline, GateQ, Meetings & activity, Portfolio, Reports | Overview, Investors, Fundraising, Meetings & requests, Updates, Reports |
| Record | A company: evidence, GateQ dossier, diligence, team notes | An investor: their requests, what you shared, their public profile |
| Private material | Sees own `organisation_private` notes, tasks and owner | **Never** sees investor-private notes, deliberations, owner or scores. A standing line says so on every tab. |
| Readings | Mandate fit, business evidence, interest, readiness, outcome | Fit of the round to their declared mandate; their stated next step. No inferred interest. |
| Money | Portfolio commitments (confirmed) | Confirmed and *stated* kept apart, never summed |
| Q drafts | Follow-ups, diligence requests, IC brief | Investor updates, request responses, meeting prep |

**Founder-view privacy (release-blocking).** It is enforced in the API read and RLS, not by the UI. Section 6 lists it as a needed negative test.

## 5. Q interactions shown

| Q state | Where in the prototype | Video |
| --- | --- | --- |
| Briefing (fast, permission-filtered) | Hub Overview, record Overview, Q panel "Brief me" | 1, 2 |
| Navigating between records | "Brief me on Halden Grid", "What should I do next?" | 2, 3 |
| Changing a filter or tab | Tour: `input.pipeline-search`, `filter.stage-in_diligence`, `tab.record-evidence` | 3 |
| Opening a document and moving to a page | Tour: `DOCUMENT_ACT GO_TO_PAGE 7` on model v3 | 1, 3 |
| Jumping to a transcript passage | Tour: meetings tab at 22:05; summary links | 1, 2, 3, 4 |
| Source-backed comparison | "Compare with Kestrel" (each cell cites its source; unknown stays unknown) | 3, 4 |
| Active and completed agent job | Q Work: "Prepare diligence brief" (running), "Weekly pipeline report" (completed) | 1, 3 |
| Action awaiting human approval | Follow-up message: approve exact text → acknowledged → sent with receipt | 1 |
| Failed act, honestly reported | "Open the term sheet" → failed, TARGET_MISSING, nothing opened | 3 |

How the prototype shows Q acting:

- **Visible target.** Q marks the control it acts on with an outline and the control id (`Q · tab.record-evidence`). This is not a glow; glow stays on the Q mark only (ADR 0017 F2).
- **Act log.** The panel lists each act with its typed name and target, and its state goes **requested → acknowledged → completed | failed**.
- **Layout.** On wide screens the Q panel opens beside the page, which reflows so Q never covers the control it acts on. On mobile it is a bottom sheet.

## 6. Simulated, existing and needed

### Simulated in the prototype

- All data, which is fictional and labelled.
- Q's wording, which is scripted.
- The briefing and its "61 events" scope.
- Comparison values.
- The receipts' read-back, which reads the prototype's own DOM.
- Approval sending (a timer, then a fake receipt id).
- Report and export downloads, which are toasts.
- Saved views (in memory).
- Board drag, which is not implemented; a note explains the intended behaviour.
- Team notes and tasks.
- Transcript timestamps.

### Already works in Capital Q (reuse)

| Capability | Where |
| --- | --- |
| Results read and PDF/CSV report for a period | `/results`, `/results/report`, `ResultsDtoSchema`, `features/results/*` |
| Canonical relationship, v2 derived states, next steps, events | `contracts/http/relationships.ts`, `features/relationships/*` (timeline, deal stage strip, diligence, commitment, outcome) |
| Relationship brief | `contracts/http/relationship-brief.ts`, `brief-lines.ts` |
| GateQ inbox, dossier, comparison, notes, assignment, pass with reason | `contracts/http/gateq-inbox.ts`, `features/gateq/page/*` |
| Capital rounds and commitments (stated or confirmed) | `capital/*`, `contracts/http/commitments.ts`, `capital-rounds.ts` |
| Meetings: schedule, Q meeting assistant, notes, follow-ups, consent and decline | `features/schedule/*`, `contracts/q/meeting-assistant.ts` |
| Documents with server sha256, data-room scopes, viewer page acts | `contracts/http/documents.ts`, `data-room.ts`, `DOCUMENT_ACT` |
| Q Work jobs, steps, approvals, decision queue | `contracts/q/work.ts`, `approval.ts`, `features/work/*` |
| Q control registry, typed UI acts, receipts, fast navigation, route table | `features/q/control/*`, `contracts/q/ui-act.ts`, `ui-intent.ts` |
| Theme switcher, tokens, Q Aperture tokens | `tokens.css`, `features/appearance` |

### Needs implementation

| Item | Kind | Notes |
| --- | --- | --- |
| `/results/[area]` routes and the label by side | Web | Add to `APP_ROUTE_PATTERNS` and `ROUTE_REDIRECTS` (the parity test enforces this) |
| Pipeline read: cursor-paginated relationship list with filters (stage, owner, sector, source, fit band) and search | **API** | Extends the relationships list; no new table. `RelationshipListDtoSchema` gains filter and cursor params. |
| Owner on a relationship (investor-side assignee) | **Schema (small)** | Proposal: an `organisation_private` assignment row keyed to the relationship, written as an event. Not a mutable column on the shared relationship. Needs RLS, cross-tenant-negative and founder-negative tests. |
| Saved views | **Schema (small)** | A per-person row (filter JSON validated by Zod, owner, optional org default). Presentation only. |
| Transcript timestamps | **Contract** | `QMeetingAssistantDto.transcript[]` gains `atMs` (additive, optional). The meeting provider adapter must supply it. |
| `OPEN_MEETING_AT`, Hub `NAVIGATE` destinations, more `Q_RELATIONSHIP_TABS`, `page` on `DATA_ROOM_DOCUMENT` | **Contract** | Additive enum members. Server tool definitions have one owner (Q orchestration lane). |
| Acknowledged receipt event | **Contract** | A non-terminal stream event before the existing terminal receipt |
| Hub FILTER and input handlers on registered controls | Web | Uses the existing registry `onAct` |
| Board move → typed action sheet | Web | Reuses `deal-actions.ts` and `outcome-actions.ts` |
| Per-relationship export job | API + worker | PDF; private sections opt-in. Founder export excludes investor-private rows by query, with a test. |
| Founder-view negative tests | Tests | Founder session must not receive investor `organisation_private` / `investor_private` notes, owner or deliberations (API and RLS) |
| Claims view per relationship (truth, evidence, lifecycle) | API | Projection over existing knowledge and evidence for the viewer's scope. Contradictions are returned, never resolved silently. |

No migration is proposed in this lane. The two small schema items go to the integration owner as a proposal.

## 7. Components

**Reuse:**

- `RelationshipTimeline`, `DealStageStrip`, `StatusPill` (with words), `RelationshipDiligence`, `RelationshipCommitment`, `RelationshipConversation`, `AskQRelationshipPanel`;
- `InboxView`, `DossierSection`, `ApplicationComparison`, `SubmittedTranscript`;
- `MeetingQ`, `DecisionQueue`, `ApproveButton`, `WorkPanel`, `FounderBook` / `InvestorBook`, `RoundCard`;
- `ActivityBars` and the Results dashboard's local `Panel` (to extract);
- `QControl` / `useQControl`.

**Proposed new:**

| Component | Purpose |
| --- | --- |
| `HubAreaTabs` | Route tabs, as registered `TAB` controls |
| `HubBriefing` | Streams into a reserved slot and carries the scope line |
| `PipelineView` | Table or board, saved views, filter and display bars, `LIST` with count |
| `RelationshipHeader` | Identity, stage, owner, next action |
| `AssessmentStrip` | The five readings, full or compact |
| `ClaimList` | Truth, evidence and lifecycle labels; contradiction row |
| `TranscriptView` | Timestamped passages, jump and find |
| `DocumentPageViewer` | Version picker, fingerprint, scope marker, page thumbnails |
| `ScopeMark` | Visibility scope in words with an icon |
| `QActLog` | requested, acknowledged, completed, failed |
| `PrivacyLine` | Founder-side statement |

## 8. Performance budgets (proposed, not measured)

The prototype was not measured against production. These are targets for the build, consistent with ux-direction §10.3 and doc 20.

| Measure (p75) | Budget |
| --- | --- |
| Click on area tab or record tab → shell painted | ≤ 100 ms (static shell, data streams) |
| Hub Overview counts visible (warm) | ≤ 600 ms |
| Briefing slot filled | ≤ 1.5 s, never blocking the counts. CLS 0 (reserved height). |
| Pipeline first page (50 rows, cursor) | ≤ 400 ms server read, ≤ 150 KB JSON |
| Filter or search change → updated list | ≤ 200 ms (INP) |
| Document page jump | ≤ 300 ms to the page at the viewer; thumbnails lazy |
| Transcript jump | ≤ 100 ms once loaded; transcript ≤ 2,000 passages, virtualised above 300 |
| Q UI act: requested → acknowledged | ≤ 150 ms; → completed within the existing `STATE_CONFIRM_MS` (6 s) or failed |
| Hub route JS | ≤ 120 KB gz above the shared shell |
| LCP / INP / CLS | ≤ 2.5 s / ≤ 200 ms / ≤ 0.1 |

## 9. Tradeoffs and open questions for the owner

1. **Relationships and Hub.** Keep the primary Relationships nav item, or redirect `/relationships` to `/results/pipeline`? This design keeps both and avoids a nav change in this lane. Merging would remove a duplicate entry point (NN/g) but touches shared navigation.
2. **Label.** Should it be "Investment Hub" / "Fundraising Hub", or keep "Results" with Hub areas inside? The label changes discoverability, not URLs.
3. **Owner and saved views.** Both need small schema additions (§6). Approve as `organisation_private` rows written by event, or defer owner to V1.1?
4. **Board drag.** Drag opens a typed action, which is slower than a CRM drag but keeps state derived. Confirm this, or keep the board read-only?
5. **Transcript timestamps** depend on the meeting provider adapter supplying offsets. Which providers do this today?
6. **Briefing wording.** Templated only (deterministic, cheapest) or a gateway model phrasing over filtered fields? The prototype assumes templated plus optional phrasing.
7. **Export.** Should a founder be able to export an investor relationship at all, given that investor-shared content would leave the platform?

Tradeoffs taken:

- Density over decoration: lists and hairline panels, not cards.
- No scores anywhere, which costs "at a glance" ranking and keeps trust.
- The Q panel reflows the page on desktop rather than floating over it. This loses width but never hides the control Q is acting on.

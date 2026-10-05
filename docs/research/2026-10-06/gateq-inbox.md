# GateQ form, investor inbox, and "Find my startup" (F1-F4)

Research agent M1, 2026-10-06. Feeds GateQ as a form (F1), its own sidebar page (F2), "Find my startup" (F3) and the investor's Gmail-like inbox (F4).

## 1. Summary for builders

- GateQ already has the right engine (`packages/gateq`): gateways with inbound modes `CLOSED / QUALIFIED / OPEN`, published versioned criteria (`TAXONOMY, GEOGRAPHY, STAGE, RAISE_SIZE, CHEQUE_COMPATIBILITY, EXCLUDED_TAXONOMY`), criterion results `MATCH / NO_MATCH / UNKNOWN` (unknown is never a soft no), outcomes `QUALIFIED / NOT_QUALIFIED / INSUFFICIENT_INFORMATION`. The form is a UI over this; no new scoring.
- **Founder side = a short form**, one screen per step on phone, pre-filled from the company profile, with an instant, honest result ("You meet 4 of 4 required criteria" / "Not enough information: add your round size"), like the landing page's try-it.
- **Investor side = an inbox** modelled on Gmail (keyboard, select, labels, stars, archive), Front (assign, internal comments, SLA warnings, rules, auto-reply) and Superhuman (split inbox, "today / later / done" triage, reminders) ([Front](https://www.getmacha.com/blog/front-shared-inbox-explained), [Superhuman](https://blog.superhuman.com/inbox-zero-in-7-steps/)).
- **"Find my startup" = two jobs under one name, by role**: for founders, *find and claim my company* (it may already exist from a deck, a GateQ application, a colleague, or public data); for investors, *describe what I want and Q finds it* (natural-language search over the network). Recommendation and reasoning in section 5.
- Every application is a row tied to the **one canonical relationship** `(company_id, investor_organisation_id)`; the inbox is a projection over `relationship_events`, not a second CRM (CLAUDE.md).

## 2. GateQ as a form (F1, F2)

### 2.1 Principles from form UX research

- One question per screen on mobile reduces abandonment and is the pattern of the landing try-it; on desktop group 3-5 fields per step.
- Pre-fill everything known from the profile; ask only what is missing. Show "From your profile" next to pre-filled values with Edit.
- Show the criteria **before** the form ("Sahel Capital looks for: Seed, Fintech, West Africa, $500k-$3M rounds"). Founders should not have to guess (published criteria already exist as `PublicGatewaySchema`).
- Unknown is allowed: "I'd rather not say" is a valid answer; the result becomes `INSUFFICIENT_INFORMATION` for that criterion, not "No".

### 2.2 Founder flow

1. **Entry**: from the investor's profile ("Apply through GateQ"), from a public gate link (`/g/<public id>`), or from the GateQ page in the sidebar (F2) which lists gates the founder has applied to and gates that match.
2. **Step 1, Your company**: pre-filled company card (name, one-liner, stage, sector, country). If the founder has no company yet: "Find my startup" (section 5) to claim or create one.
3. **Step 2, Your round**: amount, instrument, lead status, close date. Money as amount + currency.
4. **Step 3, Materials**: deck (pre-attached from Pitch deck tab), what to share from the data room (checkboxes; default only Public items; founder may add On-request items for this investor, which creates grants).
5. **Step 4, Message** (optional, ≤ 600 characters): Q can draft it from the profile (founder approves; Q writes in the house guide's warm style).
6. **Check** screen: live criteria result per criterion with plain words (MATCH "Meets", NO_MATCH "Doesn't meet", UNKNOWN "Not answered"), and the gate's decision. In `QUALIFIED` mode a required NO_MATCH blocks sending with the reason; an UNKNOWN required criterion asks for the answer.
7. **Send** (idempotent POST; consequential action). Confirmation: "Sent to Sahel Capital. They usually reply within 10 working days." (if the investor publishes an SLA).
8. **Status** on the GateQ page: Sent · Opened · In review · Asked for more · Meeting · Passed · Withdrawn. "Opened" only if the investor allows read receipts (default off; viewing is not interest, and it pressures founders). Founders can withdraw.

### 2.3 Investor gate settings (part of the GateQ page for investors)

Criteria editor (existing contracts), inbound mode, public link, intro text, SLA promise (optional: "We reply to every qualified application within 10 working days"), auto-reply text (templates, reviewed against house guide), required materials (deck required? data-room items?), questions (max 3 custom questions, short answer), who receives (assignment rules).

## 3. Investor inbox (F4)

### 3.1 Layout

Desktop: three panes (Gmail / Superhuman):
- **Left**: views and labels: Inbox (new + open) · Starred · Assigned to me · Waiting on founder · Snoozed · Done · Outside mandate · All; user labels (e.g. "IC next week", "Fintech"); per gate if several gates.
- **Middle**: list rows: checkbox, star, company name + one-liner, stage · sector · country, fit band (from matching.md), criteria summary ("4/4 required"), Q's view chip, assignee avatar, SLA indicator ("2 days left"), received date. Unread bold.
- **Right**: the application: header (company, founders, round), criteria result, fit profile (9 parameters), Q's view, founder message, deck (inline viewer at sub-tabs A5), data-room items shared, internal notes thread, activity timeline (relationship events), action bar.

Phone: list → detail full screen; swipe right = Star, swipe left = Done (archive), long-press to multi-select; a bottom action bar in detail.

### 3.2 Actions (each a relationship event; consequential ones go Prepare → Recommend → Approve)

| Action | Meaning | Notes |
|---|---|---|
| Star | Personal flag | Per user, not per firm |
| Label | Firm-shared labels | Labels are reference data per organisation |
| Assign | Give to a colleague | Notification; "Assigned to me" view; round-robin or rules optional |
| Note | Internal comment, @mention colleagues | `organisation_private`; never visible to founder; never fed to Q for other firms |
| Ask for more | Request specific items | Opens a request to the founder (data-room request flow), status "Waiting on founder" (SLA clock pauses) |
| Reply | Message the founder | Q drafts (writer + reviewer agents, J2) per house and personal guide; investor approves the exact text |
| Book a call | Scheduling | Scheduler agent proposes times; investor approves |
| Express interest | Formal interest | Server-confirmed; moves relationship state |
| Pass | Decline | Q drafts a respectful, specific decline ("outside our cheque range"); investor approves; option "Pass silently" not offered by default (founder trust); tag pass reason (reference data) for learning |
| Snooze | Hide until a date | Returns to Inbox |
| Done / archive | Out of inbox | Still searchable |
| Download pack | Zip: one-page Q summary PDF, deck (if downloadable), shared data-room files, criteria result | Watermarked per viewer; respects download permissions; audit row |
| Forward internally | Share with a colleague outside the org's seat? | No: only org members; external sharing would bypass founder consent |

Bulk actions on selection: label, assign, snooze, done, pass (each pass still gets an individual approved message; bulk-pass prepares N drafts for one review screen), download packs.

### 3.3 Filters and sorting

Filter chips: Fit band (Strong / Good / Partial / Not enough info), Criteria (all required met / some unknown / outside), Stage, Sector, Country, Round size range, Has deck, Has financials, Assigned to, Label, Received date, SLA status. Sort: Newest · Best fit · Closest to SLA deadline · Oldest waiting.

Default sort: **Closest to SLA deadline, then best fit** (founder trust and "reply to every qualified application" over activity volume).

### 3.4 Keyboard shortcuts (Gmail conventions, so investors already know them)

| Key | Action |
|---|---|
| j / k | Next / previous |
| o or Enter | Open |
| u | Back to list |
| x | Select |
| s | Star |
| e | Done (archive) |
| l | Label |
| a | Assign |
| n | Note |
| r | Reply (Q drafts) |
| p | Pass (Q drafts) |
| i | Express interest (confirm dialog) |
| d | Download pack |
| b | Snooze |
| / | Search |
| g i / g s / g a | Go to Inbox / Starred / Assigned |
| ? | Shortcut help |

Shortcuts off while typing; all actions also reachable by pointer and touch (WCAG 2.1.4: allow turning single-key shortcuts off).

### 3.5 SLA and auto-reply

- SLA per gate (optional, published): reply-by goal in working days; pre-breach warning at 75% (Front's model: warning tag, then urgent view) ([Front](https://www.getmacha.com/blog/front-shared-inbox-explained)).
- Clock pauses while "Waiting on founder".
- Auto-reply on receipt (template per gate, includes expected timing and what happens next). Auto-reply is a pre-approved template, so it is within explicit scoped delegation; any other automatic message needs approval.
- Monthly gate report for the investor: received, replied within SLA, median reply time, outcomes. This is the "qualified relationships, not activity volume" metric.

### 3.6 Q in the inbox

- On arrival: Q prepares the summary card, fit profile, Q's view, and checks for missing items ("No financials; ask for last 6 months?").
- "Q, triage my inbox": Q proposes labels, assignees and pass drafts for out-of-mandate items as **one review screen**; the investor approves in bulk or per item.
- Q never auto-passes. Hard-rule failures in QUALIFIED mode never reach the inbox (the gate stopped them); OPEN-mode applications outside mandate go to "Outside mandate".

## 4. Download pack spec

`<Company>-<YYYY-MM-DD>.zip`: `00-summary.pdf` (one page: company, round, criteria, fit profile, Q's view labelled as Q's view, contact), `01-deck.pdf` (if downloadable; otherwise omitted with a note in summary), `02-data-room/…` (only granted, downloadable files, watermarked), `03-application.json` (structured fields for CRM import; versioned schema). Generated as a JOB; link expires in 24 hours; audit row records who downloaded what. Also "Export to CSV" of the list view (fields only).

## 5. "Find my startup" (F3): definition

### 5.1 What users would expect (evidence)

- Founders on Crunchbase, Dealroom and LinkedIn expect to **find their company's existing page and claim it**, verified by a company-domain email or website ownership; if not found, create it ([Crunchbase verify](https://support.crunchbase.com/hc/en-us/articles/360022296433), [Crunchbase Manage My Company](https://support.crunchbase.com/hc/en-us/articles/360012245854-What-does-Manage-My-Company-do), [Dealroom claim](https://knowledge.dealroom.co/knowledge/creating-claiming-editing-company-profile), [LinkedIn claim](https://www.linkedin.com/help/linkedin/answer/a6275638)).
- Investors expect natural-language search ("seed agritech in Kenya with revenue") as on Harmonic or Dealroom, with saved searches and alerts.
- The phrase "Find my startup" is first-person from a founder ("my startup"), but an investor would read it as "find me a startup".

### 5.2 Recommended definition

One tab in GateQ, **label changes by role** (same feature, different jobs):

**Founder: "Find my startup"** (claim or create)
1. Search by name, website or registry number (RC number for CAC, Kenyan registration number, CIPC number, Companies House number).
2. Results show existing canonical companies (one canonical company rule) including ones created from a colleague's upload, an investor's note (only the existence and public name, never investor-private notes), or public data.
3. **Claim**: verify with an email at the company's domain (code), or by a registry document matched to the name, or by an existing member approving (if the company already has members, the claim becomes a join request to them). Verification uses `verification_claims` (identity / organisation affiliation / domain control), separate from evidence axes (ADR-001).
4. **Not found → create**: upload deck; Q works first and fills the profile (onboarding rule).
5. Duplicate protection: fuzzy match on name, domain, registry number before creating; if a near match exists, ask "Is this you?".
6. Edge: someone else claimed it wrongly → "Report a claim" goes to Capital Q integrity review.

**Investor: "Find a startup"** (describe, Q finds)
1. A single text box: "Describe what you're looking for". Example prompts from their mandate.
2. Q turns it into visible filter chips plus a thesis text (deterministic parse where possible; Q helps with the rest), runs hybrid search over discoverable companies, and shows results with fit profiles.
3. "Save as alert" → mandate watcher agent (J1) notifies on new matches; expressing interest still needs the investor's approval unless explicitly delegated.
4. "Not on Capital Q yet?" → invite a founder to apply through your gate (sends the gate link; consequential, approved).

Why both under one tab: the founder brief says "Find my startup" in the GateQ area; for founders, GateQ applications need a claimed company first, and for investors, GateQ is where companies arrive, so active search sits naturally next to the inbox. Naming by role avoids confusion.

## 6. Gaps and recommendations

1. **Founder trust guarantees**: show founders the investor's SLA and reply rate (from the gate report) before applying. This rewards responsive investors and is a Capital Q differentiator.
2. **Rejection with reasons**: a pass must state at least one reason code (outside stage / sector / cheque / timing / other). Founders get a useful no; Capital Q gets outcome data for calibration.
3. **Duplicates across gates**: if one founder applies to two gates at the same firm, merge into one relationship row (UNIQUE company-investor), show both gates in the timeline.
4. **Spam and abuse**: rate limit applications per company per gate (e.g. once per 90 days unless the investor invites again); require a claimed company.
5. **CRM export**: investors use Affinity, Attio, DealCloud, Notion, Airtable; CSV + JSON pack now, integrations later (not MVP).
6. **Notification digests** instead of one email per application (daily digest default).
7. **Accessibility**: the inbox list is a `grid` or `listbox` with proper roles; shortcuts announced; selection state not by colour alone.
8. **Seats**: assignment requires organisation members (organisations.md); a solo investor sees no Assign action.
9. **Privacy**: internal notes and labels are `organisation_private`; Q must not use one firm's notes when helping another firm or the founder.
10. **Empty states**: new gate with no applications → "Share your gate link" with copy button and a preview of the founder form.

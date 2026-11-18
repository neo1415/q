# CRM import: research, mapping and gaps (2026-11-18)

Owner decision 106: investors and founders can import the CRM or pipeline
files they already keep. Q reads each file and arranges it the way Capital Q
arranges its pipeline and relationships, "so that once they just upload, it
reads it and takes over". This note records what real CRMs export, how those
columns map onto Capital Q's model, and which fields Capital Q lacks. It
extends the earlier CRM research
([`docs/design/crm-research-2026-10-15.md`](../../design/crm-research-2026-10-15.md)),
which covered capabilities, not file formats.

## 1. What people actually export

| Product                             | Who uses it      | Export                                                                                                                                                              | Typical columns                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Affinity                            | VC, PE           | CSV per list view (the visible columns only), emailed as a link; a full download is a ZIP with one CSV per list. Crunchbase-sourced fields are left out of exports. | Organization name, domain (and all domains), Status, Owners, Date Added, Notes, Reminders, plus custom columns: Deal Source, Referred By, Focus, Thesis. Portfolio lists add Number of Shares, Share Class, Board Seat, % Ownership, Fund. People: name, primary email.                                                                                                                                   |
| DealCloud (Intapp)                  | PE, credit       | Excel export of any grid; admin-defined fields.                                                                                                                     | Deal name, company, stage, deal team / lead, source, EV or deal size, sector, geography, dates. Not publicly documented; same shape as the PE spreadsheets it replaces.                                                                                                                                                                                                                                   |
| Attio                               | VC, newer funds  | CSV per list.                                                                                                                                                       | Record name, domains, list stage (status attribute), owner, created at, custom attributes.                                                                                                                                                                                                                                                                                                                |
| HubSpot (used by many funds)        | VC, founders     | CSV or XLSX of any object view.                                                                                                                                     | Deal Name, Deal Stage, Pipeline, Amount, Close Date, Create Date, Deal Owner, Associated Company, Record ID, Last Activity Date, Next Activity Date.                                                                                                                                                                                                                                                      |
| 4Degrees                            | VC, PE, banking  | CSV import and export (fields not publicly documented).                                                                                                             | Configurable pipeline stages and owners per deal motion; relationship strength scored from email and meeting activity; AI-extracted revenue, EBITDA, valuation, industry, location.                                                                                                                                                                                                                       |
| Pipedrive (smaller funds, founders) | founders, angels | CSV or XLSX of deals.                                                                                                                                               | Title, Organization, Value, Currency, Stage, Pipeline, Owner, Expected close date, Next activity date, Lost reason.                                                                                                                                                                                                                                                                                       |
| Foundersuite                        | founders         | CSV export of the investor pipeline (plan-dependent); CSV or Excel import.                                                                                          | Investor (firm), contact name, email, stage column, check size, notes, last contact; customisable columns.                                                                                                                                                                                                                                                                                                |
| Visible (Fundraising CRM)           | founders         | Investors in bulk by CSV; one pipeline per raise with a target amount.                                                                                              | Stages Research, Contacted, Meeting, Light Diligence, Partner Meeting, Term Sheet, Closed, Keep in Touch, Passed; custom properties per investor.                                                                                                                                                                                                                                                         |
| Spreadsheet trackers                | everyone         | CSV, XLSX, Google Sheets, Airtable or Notion CSV.                                                                                                                   | Techstars: Fund name, Location, Ranking, Tranche, Fund size, Ticket size, Domain, Name of investor, Title, Contact info, Type of interest (inbound/outbound), Who can help get a meeting, Status of intro, Notes; stages New, Advancing, Soft Circled, Committed, Legal, Wired, Passed. Getdex: URL, LinkedIn, Portfolio, Primary Focus, Investment Amount (average), Priority, Status, Way in, Comments. |
| vCard, JSON                         | contact exports  | vCard from address books; JSON from APIs (Affinity, Attio, HubSpot).                                                                                                | People, not pipelines. Not imported in this slice; see §5.                                                                                                                                                                                                                                                                                                                                                |

Sources: [Affinity export help](https://support.affinity.co/s/article/How-to-export-data-from-your-Affinity-lists),
[Affinity list fields (via SDK guide)](https://yaniv-golan.github.io/affinity-sdk/latest/guides/csv-export),
[Affinity CVC best practices](https://support.affinity.co/s/article/Best-Practices-Affinity-for-Corporate-Venture-Capital),
[HubSpot deal export (Coupler)](https://blog.coupler.io/export-deals-hubspot/),
[Pipedrive export](https://support.pipedrive.com/en/article/exporting-data-from-pipedrive),
[4Degrees deal flow](https://4degrees.ai/x/deal-flow-crm),
[Foundersuite (Software Advice)](https://www.softwareadvice.com/za/investment-management/foundersuite-profile/vs/),
[Visible pipelines](https://help.visible.vc/en/articles/9761633-getting-started-with-fundraising-pipelines),
[Visible pipeline product](https://visible.vc/product/pipelines/),
[Techstars investor pipeline](https://toolkit.techstars.com/build-your-investor-pipeline),
[Getdex investor pipeline](https://getdex.com/blog/investor-pipeline/),
[Dealroom pipeline import/export](https://support.dealroom.net/en/article/how-do-i-import-and-export-deals-in-the-pipeline-1ket5jn/).
DealCloud's export columns are not public; the row above is inferred from
its product role and marked as such.

Formats in practice: CSV (comma, semicolon in European locales, sometimes
tab or UTF-16 "Unicode text" from Excel) and XLSX. Dates arrive as ISO,
`dd/mm/yyyy`, `mm/dd/yyyy`, "12 Mar 2026" or Excel serial numbers; money as
"$1.5M", "250k", "USD 2,000,000" or a bare number with a Currency column.

## 2. The column vocabulary

Every product above reduces to the same 23 fields. The header synonyms live
in code (`packages/network/src/pipeline-import/columns.ts`, `FIELD_SYNONYMS`)
and are the deterministic fallback when Q's proposed mapping is missing or
unusable.

| Field           | Typical headers                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| counterpartName | Company, Organization, Startup, Deal Name, Opportunity, Investor, Fund, Firm, Account, Name          |
| website         | Website, URL, Domain, Homepage                                                                       |
| stage           | Stage, Status, Deal Stage, Pipeline Stage, List Status, Phase                                        |
| stageDate       | Stage date, Date of status change, Date entered stage                                                |
| addedOn         | Date Added, Created, Create Date, Sourced date, First contact                                        |
| lastContactOn   | Last contact, Last interaction, Last activity, Last email, Last meeting                              |
| contactName     | Contact, Primary contact, Founder, CEO, Partner, Name of investor                                    |
| contactEmail    | Email, Contact email, Primary email                                                                  |
| contactTitle    | Title, Role, Position                                                                                |
| owner           | Owner(s), Deal owner, Deal lead, Lead partner, Assigned to                                           |
| source          | Source, Deal source, Lead source, Referred by, Intro, Warm intro, Way in, Who can help get a meeting |
| amount          | Amount, Check size, Ticket size, Round size, Raise, Deal size, Commitment, Soft circled              |
| currency        | Currency                                                                                             |
| valuation       | Valuation, Pre-money, Post-money, Valuation cap                                                      |
| round           | Round, Series, Funding stage, Investment stage                                                       |
| sector          | Sector, Industry, Vertical, Focus, Thesis                                                            |
| location        | Location, HQ, Country, City, Region                                                                  |
| priority        | Priority, Ranking, Tier, Tranche, Rating                                                             |
| notes           | Notes, Comments, Description, Last note, Memo                                                        |
| nextStep        | Next step, Next action, Follow up, To do                                                             |
| nextStepDue     | Next step date, Follow-up date, Due date, Reminder                                                   |
| passReason      | Pass reason, Lost reason, Declined reason                                                            |
| tags            | Tags, Labels, Lists                                                                                  |

Stage labels are read onto one pipeline vocabulary: RESEARCH, CONTACTED,
MEETING, DILIGENCE, TERM_SHEET, COMMITTED, CLOSED, PASSED, PAUSED, or
UNKNOWN when the label is unclear (`readStage`). "Closed lost" reads PASSED,
"Soft circled" COMMITTED, "Keep in touch" PAUSED, "Wired" CLOSED.

## 3. Mapping onto Capital Q

| Imported                                                                                                      | Lands in                                                                                                                                                              | Why                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The counterpart (name, website)                                                                               | Matched to the ONE canonical company (investor import) or investor organisation (founder import) by an authorised search: website domain first, then normalised name. | One canonical entity; no parallel CRM record.                                                                                         |
| A matched row                                                                                                 | The canonical relationship `UNIQUE (company_id, investor_organisation_id)`, created (`discovered`, private to the importing side) when it did not exist.              | Discover, GateQ and the import converge on the same row.                                                                              |
| Stage (+ stage date)                                                                                          | A `crm_stage_imported` relationship event, `investor_private` or `founder_private`, carrying the label, the read stage and the file's date when exact.                | Relationship state is a projection over events; an imported label is the importer's claim and is activity, never a shared state move. |
| Notes, contact, owner, source, amount, round, valuation, sector, location, priority, dates, pass reason, tags | One private CRM note on the importing side of that relationship (`network.relationship_notes`, `organisation_private`).                                               | The importer's own record. Never evidence, never Q context, never the counterpart's.                                                  |
| Next step (+ due date)                                                                                        | A TASK on the importing person's work board (`workspace.board_items`).                                                                                                | Human to-dos already live on the board.                                                                                               |
| An unmatched row                                                                                              | Kept as a private prospect row of the import (`network.pipeline_import_rows`, `KEPT_PRIVATE`), private to the importing organisation.                                 | Never a public canonical company or investor created from someone's private sheet.                                                    |
| An ambiguous row                                                                                              | Shown with its candidates; the importer chooses, keeps it private or skips it. Skipped unless chosen.                                                                 | Capital Q never picks between two real organisations on someone's behalf.                                                             |

Everything imported is a USER_CLAIM in ADR-001 terms. Unknown stays unknown:
a date or amount that cannot be read exactly is kept "as written" in the
note and never guessed into a typed field.

## 4. Gaps: fields Capital Q lacks

Ranked by how often they appear in the exports above and how much the
pipeline needs them. None is added in this slice; each needs its own
decision because it touches shared contracts or the projector.

1. **Pipeline owner (deal lead)** per relationship side. Every investor
   CRM has it (Affinity Owners, HubSpot Deal Owner, DealCloud deal team).
   Capital Q has organisation membership but no "who on our side owns this".
   Proposed: an `owner_membership_id` on the side's party state, set by the
   side, private to it.
2. **Source and referrer (warm intro path)**. Affinity Deal Source and
   Referred By, Techstars "Who can help get a meeting", Getdex "Way in".
   Capital Q records a relationship's origin channel (`source_type`) but not
   the person who introduced it. Proposed: a side-private `introduced_by`
   (free text or an external person) on the relationship side.
3. **The side's own pipeline stage**. Funds and founders keep their own
   stage vocabulary (Research ... Term Sheet ... Keep in Touch). Capital Q
   derives the shared relationship state and the deal stage strip from
   bilateral events only, so an imported or privately tracked stage has no
   home in the pipeline view yet. This slice records it as a private event;
   proposed next: the party-state fold reads the latest `crm_stage_imported`
   as a side-private "your stage" column, never as the shared state.
4. **Check size, target amount and valuation on the relationship**.
   Commitments exist, but a pre-commitment "expected cheque" (founder side)
   or "proposed ticket" (investor side) does not. Proposed: a side-private
   expected amount (numeric + ISO currency).
5. **Priority / tier**. Techstars Ranking and Tranche, Getdex Priority,
   Affinity custom priority. Proposed: a side-private priority on the party
   state, sortable in the pipeline.
6. **Last contact date** across channels. Capital Q sees in-product
   messages and meetings only; imported last-contact dates are kept in the
   note. Proposed: read from the Gmail and calendar integrations when
   connected.
7. **Private prospects (not on Capital Q)**. Spreadsheets hold many firms
   and companies that are not network members. This slice keeps them as
   private import rows; a first-class private prospect list (with promotion
   when the organisation later joins) would make them part of the pipeline
   view.
8. **Portfolio fields** (shares, share class, ownership %, board seat,
   fund). Affinity portfolio lists carry them; Capital Q has no portfolio
   list (gap already noted in the 2026-10-15 research). V2.
9. **Tags / lists**. Saved views cover filtering; free tags do not exist.
   Low priority.
10. **Contacts on the record**. Capital Q holds people as members of
    organisations; a CRM row's external contact (name, title, email) has no
    home except the note. Proposed with 7.

Recommended order to add: 3 (side-private stage in the pipeline view),
1 (owner), 2 (source/referrer), 4 (expected amount), 5 (priority), then 7.

## 5. Not in this slice

- vCard and JSON: contact lists, not pipelines. A vCard import belongs with
  gap 10.
- Multi-sheet workbooks: only the first worksheet is read.
- Google Sheets by link: the person downloads it as CSV or XLSX first.
- Activity history rows (one row per email or meeting) are read as one
  stage per row; a full activity import needs the gap 6 design.

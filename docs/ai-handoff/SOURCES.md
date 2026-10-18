# Source Register - Capital Q product sources

Repo `neo1415/q`, captured at `b021d53b` on 2026-10-11. Originals untouched. Text extracts: `docs/product-sources/text/*.txt`. Generated read-only.

## Files (all tracked in git: yes)

| Doc          | Path                                                                              | Tracked | Bytes  | Blob SHA                                 | Role                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------- | ------- | ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| PADL         | docs/product-sources/Real PADL - Capital Q Product Architecture Decision Log.docx | yes     | 301547 | d7817c7cbba15cc72dc76a35681291b471cef1ca | Governs. "authoritative record of the foundational architectural decisions"; "Only Locked decisions are considered authoritative" |
| Product Spec | docs/product-sources/Real CAPITAL Q PRODUCT SPECIFICATION.docx                    | yes     | 293279 | b4a79299a15ad40c89a33b1cd414c2eafeb236ab | Detailed functional behaviour within PADL ("PADL records decisions. The Product Specification explains implementation")           |
| FSR          | docs/product-sources/Capital Q Final System Review.docx                           | yes     | 37061  | 2093d5db725032506db01c0ea663a75ac44641e8 | Cross-module integrity review, Chapters 1-8 as one buildable product                                                              |
| GateQ        | docs/product-sources/CapitalQ_GateQ_Product_Feature_Specification.docx            | yes     | 49097  | d2c0d522a5effea59a6d096eae19a8b4c4f436fa | Inbound (GateQ) and outbound (Capital Q) feature complement; supplementary                                                        |

Not supplied to this session: `capital-q-codex-source-pack.zip` (requirement index and proposed agent architecture). Nothing in this register relies on it.

Header metadata as written: PADL "Version: 1.0 (Draft) / Status: Active"; Product Spec "Version: 1.0 (Draft) / Status: In Progress"; GateQ "Status: PARTIALLY VERIFIED"; FSR has no version/status header.

## PADL decisions

Full id/title/status table (165 entries): [`PADL-DECISIONS.md`](PADL-DECISIONS.md).
Lifecycle defined by PADL section 3: Proposed, Draft, Locked.
Counts by status exactly as written (165 entries, ids #001-#155; 10 ids 60-69 appear twice, so 155 unique ids):

- `LOCKED`: 58
- `Locked`: 19
- `🔒 Locked`: 52
- `Locked ✅`: 17
- `✅ Locked` (written as "Decision Status: ✅ Locked"): 18
- `LOCKED — CONCEPT; NAME TBD`: 1 (#121 Capital Q Will Introduce a Shareable Q Identity / Q Card)
- Draft / Proposed / other: 0
  All 165 are Locked in some spelling (normalised: 164 Locked + 1 Locked-concept).
  Parsing caveat: status parsed by script from the next "Status"/"Decision Status:" line after each decision heading; the "COMPLETE - ALL DECISIONS LOCKED" line is a chapter summary, not a decision.

Chapter layout seen in PADL (extract order): Sections A-G (#001-#059 philosophy, Q, intelligence, discovery, knowledge, UX), Chapter 3 UX #53-#69, Chapter 4 InvestIQ #60-#78, Chapter 5 Q #79-#96, then #97-#146 (home, discover, InvestIQ, Blueprint, fundraising, data room, Q memory), Chapter 8 trust/permissions #147-#155.

## Heading outlines (top two levels)

### PADL

Title, 1 Purpose, 2 Relationship to Other Product Documents (six layers: Vision, PADL, Product Spec, Technical Architecture, Engineering Specs, Source Code), 3 Decision Lifecycle, 4 Decision Structure (Number, Title, Decision, Rationale, Implications, Related Decisions, Status); SECTION A-G; then "Chapter 3/4/5/8" blocks. Decisions are not in Word heading styles.

### Product Specification

Chapter 1 Product Foundation & Core Operating Principles (Sections 1-8 + summary); Chapter 2 (Sections 2.1-2.5); Chapter 3 User Experience & Workflow (3.1-3.5); Chapter 4 InvestIQ Assessment Engine; Chapter 5 Q Product Specification (5.1 Q Identity, 5.2 Behavioural Intelligence, 5.3 Memory & Context, 5.4 Continuous Intelligence & Attention, 5.5 Progressive Autonomy & Delegated Execution, 5.6 Multimodal Interaction, 5.7 Institutional Intelligence Services, 5.8 Explainability, Trust & Institutional Learning); Chapter 6 Product Platform Experience (marked COMPLETE); Chapter 7 Q Intelligence & Product Architecture; Chapter 8 Trust, Permissions, Security & Platform Integrity. Each section: Objective, Overview, Functional Requirements, User Experience, Business Rules, Dependencies, Future Considerations.

### Final System Review (35 numbered sections)

1 Product reduced to core system (five loops); 2 Contradiction Review (Findings 1-14); 3 Founder Privacy vs Investor Intelligence; 4 InvestIQ vs Investor Matching; 5 Match vs Connection vs Relationship vs Deal; 6 GateQ vs Discover; 7 GateQ Criteria vs Q Matching; 8 Company Profile vs Q Card; 9 Data Room vs Q Knowledge; 10 Data Room vs Company Profile; 11 Blueprint vs PM; 12 Fundraising Workspace vs CRM; 13 Meeting Intelligence vs Native Meetings; 14 Q Memory vs Audit History; 15 Intelligence Graph vs Relationship Graph; 16 Unresolved Decision Review; 17-19 Missing Critical Flows; 20 Complexity; 21 Day-One architecture; 22 Not-V1-sophistication; 23 Product Hierarchy; 24 Navigation; 25-27 Three prohibited failures; 28-31 Truth / Permissions / Autonomy / Intelligence hierarchies; 32 Buildability Verdict; 33 Final Contradiction Register; 34-35 One-sentence system and principle.

### GateQ Feature Specification

Part I GateQ Features (1-20: embeddable gateway ... multi-vertical config); Part II Capital Q Features (1-28: Living Company Profile, Q Card, Q Score, Q Verified, search, recommendations, swipe, pitch video, thesis profile, Q Match ... Capital Q Intelligence Feed); Part III Shared Platform Features (1-7: identity, shared intelligence layer, RBAC, notifications, audit trail, analytics, API); Part IV Recommended Product Modules; MVP Boundary: Recommended First Build; Features to Design Before Building; Product Principle.

## Explicit conflicts / inconsistencies noticed (quotes short; no amendments proposed)

1. PADL id collision: decisions #60-#69 are used twice - Chapter 3 (e.g. #60 "Investor Discovery Shall Be Personalised Through Configurable Discovery Profiles", #63 "AI-Native Investment Relationship CRM") and Chapter 4 (e.g. #60 "InvestIQ Shall Use a Multi-Dimensional Institutional Assessment Framework", #63 "Seven Core ... Dimensions"). Cross-references like "#63" are ambiguous. Heading #81 also appears twice (identical text). Also Ch.3 headings use "Decision #53:" style vs later "Decision #98 -" style.
2. Document status vs authority: PADL header "Version: 1.0 (Draft)" with "Status: Active", while stating "Only Locked decisions are considered authoritative". Product Spec header "Status: In Progress" while stating it is "the authoritative reference for product design, engineering...". Chapter 6 says "COMPLETE", Chapter 7 closing "Chapter Status".
3. Scoring vocabulary: GateQ Part II.3 "Q Score and Investment Intelligence" (dimensions incl. "overall priority") and GateQ Part I.11 "Investment Intelligence Scoring"; PADL/Spec use "InvestIQ" with "Every Assessment Produces Two Independent Scores" (#17: Business Score + Intelligence Confidence) and "cannot be fairly represented by a single score"; FSR Finding 3 "These Systems Must Not Collapse Into One Score". GateQ says its Q Score gives "a common language ... without pretending that one number determines investment quality" - consistent in spirit, but the name "Q Score" is not in PADL/Spec (Spec mentions only "InvestIQ Score: 62" in an example). The word "InvestIQ" does not appear in the GateQ doc (0 hits).
4. Q Card naming: PADL #121 "LOCKED - CONCEPT; NAME TBD" and FSR 16.C "Still intentionally unresolved ... treat it internally as: Shareable Q Identity"; GateQ and FSR use "Q Card" as the working name.
5. GateQ doc self-states "Status: PARTIALLY VERIFIED"; its own sections "Features to Design Before Building" lists Q Score methodology, Q Verified standard, Q Card fields, interest visibility as not yet specified, whereas PADL has locked decisions on several (e.g. #129 profile-viewing visibility, #147 progressive verification). Treat GateQ as supplementary per authority order.
6. FSR "Finding 1 ... Status: RESOLVED" style: FSR states "No architectural contradiction requires redesign" and 14 findings resolved; not verified here against each PADL decision.
   No other direct contradictions identified in the time spent; this was not an exhaustive cross-read.

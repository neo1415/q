# Plain-language UX writing for Capital Q (H1)

Research agent M1, 2026-10-06. Feeds H1 (audit every screen's wording for non-technical investors and founders) and H2 (journey follows the UX).

## 1. Principles (from GOV.UK, Mailchimp, Stripe, Wise, Atlassian)

1. **Short, common words.** GOV.UK: do not use formal or long words when short ones will do ("buy" not "purchase", "help" not "assist", "about" not "approximately"); avoid metaphors and buzzwords such as *drive, unlock, deep dive, robust, key, hub, landscape, ecosystem, going forward, leverage, facilitate, empower* ([GOV.UK words to avoid](https://civilservice.blog.gov.uk/2022/08/16/a-simple-guide-on-words-to-avoid-in-government/), [GOV.UK clear language](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/), [GOV.UK A to Z](https://www.gov.uk/guidance/style-guide/a-to-z)).
2. **One voice, many tones.** Mailchimp: the voice stays the same; the tone changes with the reader's situation and emotion; clarity over entertainment ([Mailchimp voice and tone](https://styleguide.mailchimp.com/voice-and-tone/)). Capital Q's voice: **calm, precise, warm, plain** (an institutional analyst who explains without talking down). Tone: celebratory for a match, neutral for a pass, careful for money and risk, brief for errors.
3. **Errors answer three questions**: what happened, why, what to do now. Stripe's decline message is the model: "Your card was declined. The issuing bank did not approve the transaction. Try a different payment method or contact your bank." ([Kitemetric on Stripe errors](https://kitemetric.com/blogs/communicating-stripe-payment-errors-gracefully), [Atlassian error messages](https://atlassian.design/content/writing-guidelines/writing-error-messages), [Google tech writing](https://developers.google.cn/tech-writing/error-messages/summary?authuser=0)). Never blame the user; never show codes alone.
4. **Talk about money openly and globally.** Wise's voice emphasises speed, ease and transparency, without a West-centred currency focus ([Wise voice case study](https://view.ceros.com/centaur-media/writing-for-design-2)). For Capital Q: always show currency (₦, KSh, R, $) with amounts; no assumption that USD is default.
5. **Front-load.** Put the most important word first in buttons, headings and list items ("Request access", not "Click here to request access").
6. **Say what will happen.** Buttons are verbs that name the result: "Send to Sahel Capital", "Share with 3 investors", not "Submit" or "OK".
7. **Sentence case** everywhere; no ALL CAPS, no Title Case Headings, no tracking-widest eyebrows (CLAUDE.md prohibition).
8. **Numbers**: digits not words ("3 investors"); dates as "6 Oct 2026" (unambiguous internationally); relative time for recent ("2 days ago") with exact date on hover.
9. **Reading level**: aim for about age 9-12 reading age (GOV.UK guidance targets plain English for everyone); many users read English as a second language (Nigeria, Kenya, francophone Africa). Avoid idioms ("ballpark", "circle back", "move the needle").
10. **Honest uncertainty**: "Not known yet" beats "N/A" or "0". Never imply a company is weak because data is missing (CLAUDE.md).

## 2. Capital Q vocabulary: internal term → what users see

Internal architecture words stay in code. Users see the right column.

| Internal (code, docs) | On screen | Notes |
|---|---|---|
| truth_class VERIFIED | **Verified** | Only when verified |
| truth_class USER_CLAIM | **Shared by the company** / **Shared by the investor** | Not "claim" (sounds accusatory) |
| truth_class ESTIMATE | **Estimate** | |
| truth_class Q_INFERENCE | **Q's read** or **Q thinks** | Never "inference" |
| truth_class UNKNOWN | **Not known yet** | |
| evidence_status NO_EVIDENCE | **No proof yet** | |
| SELF_REPORTED | **Self-reported** → **Shared, not checked** | "Self-reported" is jargon for many |
| DOCUMENT_SUPPORTED | **Backed by a document** | |
| MULTI_SOURCE_SUPPORTED | **Backed by several sources** | |
| EXTERNALLY_VERIFIED / PLATFORM_VERIFIED | **Verified by [source]** / **Verified by Capital Q** | |
| lifecycle STALE | **Out of date** | Say how old |
| CONTRADICTORY | **Doesn't match** + what disagrees | "Deck says 4,000 customers; financials say 3,200" |
| DISPUTED | **Questioned** | |
| SUPERSEDED / HISTORICAL | **Older version** | |
| Mandate (investor) | **What you invest in** (headings) / **Mandate** OK for professional investors in detail views | Many angels don't use "mandate" |
| Declared mandate | **What you told us** | |
| Observed behaviour | never shown as a label | |
| Fit / match score | **Fit** (bands: Strong fit · Good fit · Partial fit · Not enough information) | Not "match score 82%" |
| Confidence | **How sure we are: High / Medium / Low** | No percentages |
| Readiness | **Investor-ready checklist** / **What investors will ask for** | |
| Qualification (GateQ) | **Meets their criteria** / **Doesn't meet** / **Not answered** | |
| INSUFFICIENT_INFORMATION | **Need a bit more information** | Plus what's missing |
| Relationship state | Plain stages: **New · Talking · Meeting booked · Reviewing · Passed · Invested** | |
| Express interest | **I'm interested** (button) / "expressed interest" in history | |
| Pass | **Pass** (neutral) / **Not for me** in Explore | Pass is neutral, not red (CLAUDE.md) |
| Discoverability | **Who can find your company** | |
| Visibility scope network_visible | **Investors on Capital Q** | |
| public_external | **Anyone with the link** | Keep distinct (ADR-001) |
| relationship_shared | **This investor only** / **This company only** | |
| specifically_shared | **People you choose** | |
| organisation_private | **Only your team** | |
| founder_private / personal_private | **Only you** | |
| Organisation | **Company** (founders) / **Firm** (investors) | organisations.md |
| Membership role admin/member | **Admin / Member**; **Owner** | |
| Data room grant | **Shared with** | |
| Slate / feed | **Your list** / **For you** | Never "slate" |
| Artifact (Q output) | **Result** / the thing's name ("Comparison", "Memo") | |
| Board (Q) | **Board** (founder-chosen) — explain once: "Your saved answers" | |
| Specialist / agent names | never shown | Show verbs: "Checking against your guide" |
| Prepare → Recommend → Approve | **Q drafted this. Check and send.** | |
| Idempotency, payload, tenant, projection, canonical, provenance, embedding, RLS | never on screen | |
| Provenance / source | **Where this comes from** | Link to slide or document |

## 3. Find-and-replace list (generic jargon to avoid)

| Avoid | Use |
|---|---|
| utilise, leverage | use |
| facilitate, empower, enable | help, let |
| commence, initiate | start |
| terminate | end, stop |
| purchase | buy |
| sufficient | enough |
| approximately | about |
| in order to | to |
| in relation to, with regard to | about |
| prior to | before |
| subsequently | then, later |
| assist | help |
| obtain, acquire | get |
| require | need |
| additional | more, extra |
| numerous | many |
| ensure | make sure |
| deliver (non-physical) | make, give, provide |
| robust | strong, reliable (or say why) |
| seamless | (delete; show it) |
| insights | what we found, findings |
| intelligence (as a noun for outputs) | analysis, findings |
| actionable | (delete) or "you can act on" |
| unlock, supercharge, 10x | (delete) |
| deep dive | detailed look |
| synergy, ecosystem, landscape | (be specific: "investors in Lagos") |
| journey (as jargon) | steps, process |
| onboarding | getting started, set up |
| user | you, the founder, the investor |
| submit | send, apply, save (say the result) |
| proceed | continue |
| invalid | say what's wrong ("Use a date after today") |
| error occurred | say what failed and what to do |
| something went wrong | only as a last resort, with a next step |
| N/A, null, — | Not known yet / Not shared / Doesn't apply |
| please note that | (delete) |
| successfully | (delete: "Sent" not "Successfully sent") |
| click here | name the destination |
| AI-powered, AI-driven | (delete; let the product show it) |
| pre-revenue | no revenue yet |
| TAM / SAM / SOM | market size (with abbreviation explained once for founders) |
| ARR / MRR | yearly / monthly recurring revenue (abbreviation after first use; investors know these, founders may not) |
| runway | months of cash left |
| burn | monthly spending |
| cap table | who owns the company (cap table) |
| SAFE | SAFE (simple agreement for future equity) on first use |
| KYC / KYB | identity checks / company checks |
| due diligence | checking the company (due diligence) |

Investor-specific terms (ARR, cap table, pro rata, SAFE, lead) are acceptable in investor views; founder views explain them on first use. Never hide the professional term entirely: show both ("months of cash left (runway)").

## 4. Patterns for common screens

- **Empty states**: say what this place is for, and one action. "No company requests yet. Share your gate link so founders can apply." [Copy link]
- **Loading**: say what is happening if > 1 s: "Q is reading your deck (12 slides)". No "Loading..." alone.
- **Q results**: lead with the answer: "Top 3 for your mandate: AgroLedger, MedRoute, PayFlow." Then reasons.
- **Confirmation dialogs**: title = the action as a question ("Remove Tunde from AgroLedger?"), body = consequence ("They'll lose access right away."), buttons = specific verbs ("Remove" / "Keep"). Destructive in a neutral or red style plus the word, never colour alone.
- **Errors**: "We couldn't send your application. Your connection dropped. Try again." [Try again]. "This file is too big (48 MB). The limit is 25 MB. Compress it or upload a smaller version."
- **Uncertainty**: "Q's read: worth a look. Strong team and growth; churn not known yet."
- **Permissions**: "Only your team can see this." / "Sahel Capital can see this until 6 Nov."
- **Money**: "₦45m (about $29k) monthly revenue, Sep 2026" — local currency first when that is how it was reported, conversion labelled "about" with date.

## 5. Audit method (H1, H2)

1. Extract all user-facing strings from `apps/web` (JSX text, `aria-label`, `title`, placeholder, toast and error strings, Q system copy) into a sheet with screen and component.
2. Flag by the lists above (search for each "Avoid" term and each internal term), plus length (button > 3 words, heading > 8 words, body sentence > 20 words).
3. Rewrite in place; keep a glossary file (this table) as the source; reviewers check new copy against it.
4. Read each journey aloud end to end (founder: sign up → upload deck → see profile → data room → apply via GateQ; investor: sign up → mandate → For you → profile → interest → inbox). If a step needs explaining, the UI or the words are wrong (H2).
5. Test with 3-5 non-technical users (one founder, one angel, one associate), asking them to say what each screen is for.

## 6. Gaps and recommendations

1. **Centralise strings** (one module per feature) so copy can be audited and later translated (French and Portuguese for francophone and lusophone Africa; Arabic for the Gulf is a big RTL change, plan later).
2. **Q's own words** follow the same guide: put this guide into the house guide used by writer and reviewer agents (agent-workforce.md J8), so Q's spoken and written answers avoid the same jargon.
3. **Accessible names**: icon buttons need text labels ("Pass", "Save"), not "button".
4. **No fake precision**: never "87.3% fit"; bands and words only.
5. **Avoid alarm**: "Doesn't match" (yellow/neutral icon + words) for contradictions, not red warnings, unless money or security is at risk.
6. **Consistency check in CI**: a simple lint that fails on banned words in JSX text (allowlist for investor-pro terms) — deterministic, cheap; this is a style check, not a product phrase list (J7 concerns runtime intelligence).

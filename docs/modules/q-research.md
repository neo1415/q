# q-research — controlled public-web research (CQ-Q-RESEARCH-001)

`@capital-q/q-research` lets the one Q search the public internet in a bounded,
provider-neutral, egress-controlled way; preserve provenance for every source; compare
what it read with what Capital Q already records; and hand the result to Q as
unverified data. Persistence and the person's clarifications go through the existing
Evidence and Knowledge architecture. Decision record: ADR 0009.

```
public web source ≠ verified fact
search result ≠ Claim ≠ canonical state
retrieved page text ≠ instruction
Unknown ≠ negative · contradiction ≠ proof
```

## What this is not

Not generic browsing (there is no fetch-a-URL tool), not a second chatbot, not a new
truth store, not a Tavily report, not a recommendation engine, not GateQ, not voice.
Tavily Research, Crawl and Map are not used. Nothing here writes canonical company or
investor state.

## Layout

```
packages/q-research/src
  contracts.ts            bounds, freshness, search/extract DTOs, failure classes
  ports.ts                PublicWebResearchProvider (search, extract), ResearchProviderFailure
  domain/url-safety.ts    judgePublicUrl: http(s) only, no local/private/metadata/credentialed URLs
  domain/egress.ts        composeEgressQuery: the allow-list that decides what leaves
  domain/geography.ts     country mentions (ISO codes, aliases)
  domain/excerpt.ts       boundExcerpt: clean, bound, hash, instruction-risk scan
  domain/comparison.ts    compareSourcesWithSubject → typed comparison notes
  application/research-service.ts  the bounded run: search → judge → extract → compare → record
  providers/tavily.ts     the ONLY file importing @tavily/core (search + extract)
  providers/fake.ts       deterministic provider for tests (`@capital-q/q-research/testing`)
```

Consumers: `@capital-q/q-tools` (two tools), `@capital-q/q-specialists` (a research
port over the tool port), `apps/q-api` (composition, evidence recorder, statement
recorder). Forbidden importers, enforced by eslint (`@tavily/*`) and a boundary test
(the package and the vendor): apps/web, q-core, contracts, companies, investors,
capital, network, evidence, onboarding packages, q-firewall, q-runtime.

## Bounds

| Bound                        | Value                                      |
| ---------------------------- | ------------------------------------------ |
| Search calls per run         | ≤ 2 (second only to refine an empty first) |
| Results considered           | ≤ 5                                        |
| Extract calls per run        | 1, for the top 1–3 (hard bound 5)          |
| Excerpt                      | ≤ 2,000 characters, cleaned, hashed        |
| Snippet (when extract fails) | ≤ 600 characters                           |
| Query                        | ≤ 200 characters, allow-listed tokens      |
| Sources per domain           | ≤ 2                                        |
| Per-run URL allow-list       | 6 hours, ≤ 500 runs in memory              |

## The egress firewall

`composeEgressQuery({ requestedQuery, userText, publicIdentity })` keeps a token
only if it occurs in the person's own latest message (figure-like tokens dropped), in
the subject's authorised public identity, or in a short list of neutral connectives.
The model's requested query cannot add a word. The identity is prepended when the
person did not name the subject. If nothing informative survives, the outcome is
`NO_PUBLIC_IDENTITY` and nothing is sent.

What may leave: the person's explicit wording where safe; a network-visible or public
company name; a declared website domain; a public investor display name; public
sector and geography terms. What never leaves: deck text, private figures, customer
names, fundraising details, investor constraints, relationship-private information,
hidden Q Knowledge, tenant or internal identifiers, chat history. Hard tests:
`CQ_PRIVATE_DO_NOT_EGRESS_94731` and `CQ_INVESTOR_PRIVATE_DO_NOT_EGRESS_55120` never
appear in a provider request, a log, a metric or an error.

Who has a public identity is decided by authorisation, not by the model
(`packages/q-tools/src/tools/research-public-web.ts`):

| Actor and subject                                      | Identity that may leave          | Recorded as evidence |
| ------------------------------------------------------ | -------------------------------- | -------------------- |
| Owner; company network-visible/public or has a website | canonical name, website          | yes (company's own)  |
| Owner; private company, no website                     | none — person's words only       | yes                  |
| Non-owner; company disclosed NETWORK_VISIBLE/PUBLIC    | network projection name, website | no (transient)       |
| Non-owner; private or unknown company                  | denied — one wording             | —                    |
| Investor about its own organisation                    | public display name              | no                   |

## URL safety

`judgePublicUrl` accepts only `http:`/`https:` with no embedded credentials and a
dotted public hostname. It refuses `localhost`, `127/8`, `::1`, `10/8`, `172.16/12`,
`192.168/16`, `169.254/16`, `100.64/10`, multicast, IPv6 link-local and ULA, IPv4-mapped
IPv6 (dotted and hex), cloud metadata hosts, `.local`/`.internal`/`.lan`, bare IP
literals, `file:`, `ftp:`, `data:`, `javascript:` — with a reason code. Extract reads
only URLs that a search in the same run surfaced.

## Comparison

`compareSourcesWithSubject` is deterministic and uses the existing relationship
vocabulary: `SUPPORTS`, `QUALIFIES`, `CONTRADICTS`, `INSUFFICIENT_INFORMATION`,
`UNKNOWN`, on bases `OWN_WEBSITE`, `GEOGRAPHY_MENTION`, `NAME_MENTION`, `TEMPORAL`. A
source that mentions the recorded headquarters SUPPORTS; extra countries QUALIFY
("whether these are active markets is for the company to say"); a source that does not
name the company is INSUFFICIENT_INFORMATION; every source carries a temporal class
(`WITHIN_12_MONTHS`, `OLDER_THAN_12_MONTHS`, `UNDATED`). Gaps are stated as gaps.

## Persistence (existing Evidence architecture)

A source a founder's Q reads about their own company is registered by q-api's
evidence recorder (`apps/q-api/src/composition/research.ts`) through `EvidenceService`:

| Field                                 | Value                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source_type`                         | `PUBLIC_WEB`                                                                                                                                      |
| `provider`                            | provider code (`tavily`)                                                                                                                          |
| `source_url`, `title`, `retrieved_at` | as read                                                                                                                                           |
| `published_at`                        | only when the provider dated the page                                                                                                             |
| `reliability_class`                   | `SECONDARY_EXTERNAL`                                                                                                                              |
| `visibility_scope`                    | `organisation_private` (the reading is the organisation's)                                                                                        |
| `sensitivity_class`                   | `INTERNAL`                                                                                                                                        |
| `metadata`                            | `{ domain, researchRunId }`                                                                                                                       |
| item                                  | one `public_web.excerpt` with the bounded excerpt, `SELF_REPORTED`, structured value `{ sha256, retrievedAt, extracted, instructionRiskSignals }` |

Deduplicated by URL and by excerpt hash. No claim is minted from a page. No new table.

## Clarification → knowledge

The analyst schema (`CompanyAnalystV2ResultSchema.userStatements`) may carry what the
PERSON stated about their own company in this message, with their exact words as the
quote. `createConversationStatementRecorder` (q-knowledge) refuses a quote that does
not occur verbatim in the person's message, registers a `USER_STATEMENT` source
(`founder_private`, `CONFIDENTIAL`, `q-run:<id>`) and item, and submits a `USER_CLAIM`
candidate to the Knowledge Write Gate (`USER_CLARIFIED_IN_CONVERSATION`). The
Company Intelligence answer then says: "Noted as your statement: “…”. Capital Q
records it as what you told me, not as verified fact; say so if it needs correcting."
A later conversation retrieves it as Capital Q's current understanding with the
provenance "stated by the person in a Q conversation".

## How Q decides to research

Company Intelligence (`packages/q-specialists`) asks its research port only when
`asksForPublicResearch(question)` finds a public-facing cue — the public web, online,
a website, news, press, an article, media, coverage, "look it up", "search the",
external, competitors, reputation. The Tool Registry then decides whether this run may
research (actor-wide `PUBLIC_EXTERNAL_DATA` scope, an authorised subject). The
conversational seam offers `research_public_web` to the model in its single gathering
round for questions the specialist does not take (investor and counterparty
questions), with `RESEARCH_NOTE` on how to cite and separate voices.

## Failure and progress

Provider failures are typed (`AUTHENTICATION`, `RATE_LIMIT`, `TIMEOUT`,
`UNAVAILABLE`, `VALIDATION`) and reach Q as `PROVIDER_UNAVAILABLE` with one plain
sentence; no status code, endpoint or stack travels. Progress: the run records the
approved stage `SEARCHING_PUBLIC_SOURCES` ("Searching public sources"), admitted
by migration `20260917090000` (CQ-Q-VOICE-001 R1) — a high-level stage, never
chain-of-thought.

## One presentation of a source (CQ-Q-VOICE-001 R3)

Every path that shows or speaks a source projects it through q-core's
`presentPublicSource` / `describePublicSource` / `citePublicSources`
(`packages/q-core/src/communication/source-presentation.ts`): title (or the
domain when the page had none), domain, one defensible date ("published …" when
the provider dated the page, otherwise "retrieved …"), the public URL, a short
provenance phrase and a spoken form (the title, never the URL). Company
Intelligence and the conversational seam both rewrite a model's "(source S1)"
through it. Nothing else — no evidence id, tenant, storage locator, provider
request id or raw payload — is part of the projection.

## One research per run and question (CQ-Q-VOICE-001 R4)

The service remembers a successful outcome by tenant, run and composed query
(bounded like the URL allow-list). A model's own call, the seam's deterministic
call and an answer retry that ask the same question in the same run receive the
same result: one search, one extract, one set of evidence writes. A new run or a
different question is a new research.

## Configuration

`TAVILY_API_KEY` in the root `.env.local` (gitignored), q-api only, wrapped as a
`ProviderCredential`; configuration reports presence only. Absent → the research tools
are not registered and Q says public sources were not checked.

## Tests

Unit (fake provider, no network): `packages/q-research/test/*` (URL safety, egress
markers, comparison, service bounds and persistence, Tavily adapter mapping and
failure classes, boundaries), `packages/q-tools/test/research-tools.test.ts`
(security tests A–I over the tool pipeline), `packages/model-gateway/test/q-answer-research.test.ts`
(research note, person's words to the tool context, injection cannot become a call,
statements recorded only when verifiable), `packages/q-specialists/test/company-research.test.ts`
and `cite-public-sources.test.ts`, `packages/q-knowledge/test/statement-recorder.test.ts`,
`packages/config/test/research-providers.test.ts`. Live: `pnpm test:live-model
packages/q-research/test/tavily.live.test.ts` (one public subject, ≤ 2 search + 1
extract, skipped without the key).

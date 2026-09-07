# Q Core: Prompt Registry and Q System Charter (`@capital-q/q-core`, CQ-Q-006)

**Purpose.** Q's governed behavioural core: the versioned, immutable,
provider-neutral prompt definitions (the Q System Charter and the task
prompts), their variable and output schemas, the renderer that turns a
definition plus already-authorised inputs into a provider-neutral message
list with untrusted-content fences, bounded communication guidance, the
operating-mode and proactivity-mode vocabulary, prompt bundle identity, and
the synthetic regression fixtures. Pure and server-side: no database, no
provider SDK, no retrieval, no tool.

```
Q Core Charter ≠ task prompt ≠ communication profile ≠ operating mode
prompt version  ≠ "latest"
system prompt   ≠ security boundary   (the Context Firewall and tool authorization are)
model output    ≠ canonical truth
one Q, whichever model answered
```

## Source basis of the charter

Product Specification 2.5 (personality), 2.6 (communication style), 2.7
(thinking model), 2.8 (operating modes), "Communication Philosophy" and
"Behavioural Principles", 5.1 (identity: "Your Intelligent Investment
Analytical Partner", one Q, internal specialists invisible); PADL Decision
11 (founder's best interest, warm without sacrificing objectivity, never
flatter), Decision 12 (assessment precedes advice), Decision 43 (depth
follows significance; four reasoning layers are an internal framework, not
a template), Decisions 83 and 84 (proactivity earned; Focus, Standard,
Proactive), Decision 85 (collaborative analyst; challenge only when it
materially improves the decision; not a devil's advocate; diagnosis versus
execution); Final System Review ("One Q"); doc 12 §26 and §40; doc 15 §47
and §48; doc 23 §127 to §129; doc 24 §81 to §85, §98 to §99, §280, §285.

No source names a "Practice" mode, so none is modelled.

## Four things kept apart

| Concept               | Where                               | Changes                                                                                  |
| --------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Q Core Charter        | `Q_SYSTEM` (charter/q-system.v1.ts) | Identity and non-negotiable behaviour. New version only.                                 |
| Task prompt           | `tasks/*.v1.ts`                     | Instructions for one job; nothing about style or identity.                               |
| Communication profile | contracts `QCommunicationProfile`   | Presentation: depth, register, challenge, questions, order.                              |
| Operating mode        | contracts `QOperatingMode`          | What kind of work: ASSESSMENT (no coaching), DEBRIEF, INVESTOR, CONTINUOUS_INTELLIGENCE. |

Proactivity (`QProactivityMode`: FOCUS, STANDARD, PROACTIVE) is a fourth,
separate axis about attention; no runtime reads it yet.

## Registry

`createDefaultPromptRegistry()` holds the source-controlled definitions.
`get(id, version)`, `getActive(id)`, `list()`. A definition is an id,
integer version, status, kind, task class (tasks), owner, change
description, effective date, a Zod variable schema with the names of its
UNTRUSTED variables, an output spec (TEXT or STRUCTURED with a named,
versioned Zod schema), and a template with `{{variable}}` tokens.

Storage is source-controlled files, as doc 12 §26 and doc 23 §127 require.
There is no prompt table, no CMS, no hosted prompt service.

**Immutability.** Records are frozen; a registry refuses duplicate
versions and two ACTIVE versions of one id; `prompts.lock.json` pins every
version's content hash, and the q-core test fails when a published
version's text changes without a new version. A material change is
`company-analyst/v2`, with the old version DEPRECATED.

## Prompt versions (initial)

| Prompt                        | Version                          | Task class            | Output                            |
| ----------------------------- | -------------------------------- | --------------------- | --------------------------------- |
| Q_SYSTEM                      | q-system/v1                      | (charter)             | text                              |
| COMPANY_ANALYST               | company-analyst/v2               | EVIDENCE_SYNTHESIS    | CompanyAnalystResult/v2           |
| FOUNDER_ONBOARDING_EXTRACTION | founder-onboarding-extraction/v1 | STRUCTURED_EXTRACTION | FounderExtractionResult/v1        |
| INVESTOR_MANDATE_SYNTHESIS    | investor-mandate-synthesis/v1    | STRUCTURED_EXTRACTION | InvestorMandateSynthesisResult/v1 |
| FIT_EXPLANATION               | fit-explanation/v1               | NORMAL_DIALOGUE       | FitExplanationResult/v1           |

A task prompt's task class is a request to the Model Gateway; the routing
policy chooses the model. No prompt names a provider or a model (tested).

`company-analyst/v1` is retained as DEPRECATED — immutable, resolvable by
exact version, and pinned in `prompts.lock.json` with its original hash — so
a run recorded against it stays explainable. v2 (CQ-Q-020) adds the
structured company reading, citation by opaque fact label, and the trusted
institutional frame the server establishes before the model runs; every new
output field is defaulted, so a response shaped for v1 still validates.

## Rendering

`renderPrompt(registry, { task, operatingMode, communicationProfile,
environmentNotes, variables })` returns the provider-neutral messages
(SYSTEM = charter with the rendered communication guidance and operating
mode; USER = task rendering), the gateway output spec, the Zod schema that
accepts the result, the rendered size, and the bundle.

Every token must be a declared variable; undeclared or override-shaped
keys (`systemOverride`, `policyOverride`) are refused. Variables marked
untrusted (the person's message, conversation turns, authorised facts,
documents, factors) are wrapped in explicit fences:

```
<<<UNTRUSTED_CONTENT source="userMessage">>>
...content...
<<<END_UNTRUSTED_CONTENT>>>
```

Fence markers inside content are neutralised so content cannot close or
reopen a fence. The charter and each task state that fenced content is
data to be analysed, never instruction. This is a boundary for the model,
not a security control: the Context Firewall decides what enters, tool
authorization (CQ-Q-007) decides what runs, and system prompt secrecy is
defence in depth only (doc 15 §48).

The renderer has no ports: it consumes already-authorised inputs and
cannot fetch. The answer seam (`@capital-q/model-gateway/q`) assembles the
inputs from the run and from an authorised-context port that CQ-RAG will
implement behind the firewall plan.

## Prompt bundle identity

`bundleVersion` = `<charter>_<task>_comm.v<n>`, e.g.
`q-system.v1_company-analyst.v1_comm.v1` (fits the 64-character
`q_runtime.runs.prompt_bundle_version` check); `bundleHash` = sha256 over
the member content hashes for integrity. A completed run records the
bundle version alongside `model_policy_version` and
`orchestration_version` (now `q-orchestrator-v4`), so any run answers:
which orchestration, which prompts, which routing policy, which
provider/model.

## Communication profile

`QCommunicationProfile` (contracts): `responseDepth` CONCISE | BALANCED |
DETAILED, `tone` PROFESSIONAL | CONVERSATIONAL, `challengeLevel` SUPPORTIVE
| BALANCED | CHALLENGING, `questionStyle` MINIMAL | ADAPTIVE | SOCRATIC,
`explanationStyle` SUMMARY_FIRST | ANALYSIS_FIRST. Strict: no other key,
no free text. Presets BALANCED (default), DIRECT, ANALYTICAL, COACHING are
profiles, nothing more.

`renderCommunicationGuidance(profile)` produces one bounded block placed in
the charter's COMMUNICATION PROFILE section, which states that the charter
wins where they conflict and that material uncertainty, risks and missing
evidence are stated regardless. Task prompts carry no style text, so a
default or a preset changes in one place.

Precedence: locked charter > task behaviour > security and authority >
communication profile > the person's in-message style request.

**Future user settings.** A settings context validates a user's choice into
a `QCommunicationProfile` (or preset) and hands it to the answer seam's
`QCommunicationProfilePort`. There is no `systemPrompt`, `customInstructions`
or `developerPrompt` setting, and there never will be one on the public Q
API.

## Structured outputs

All four task prompts produce schema-validated JSON through the Model
Gateway's structured path; the seam stores only `answer` as the Q message.
Founder extraction candidates carry `truthClass` (never VERIFIED) and
`evidenceStatus` (never document- or platform-verified), quotes, and an
`explicit` flag; mandate synthesis keeps `declared`, `inferred` and
`tensions` apart; fit explanation restates the supplied label and never
invents a probability. A schema-valid result is still a model output: no
prompt here writes a company, mandate, claim or relationship.

## Behaviour observed (real synthetic conversations, `pnpm q:smoke`)

Seven fixture scenarios ran end to end through the real firewall, this
registry, the gateway and both providers. Q answered a factual question in
one sentence; analysed a raise-size question with options, assumptions and
a conditional recommendation; said plainly when gross margin could not be
computed; refused to confirm "excellent retention" against a churn document
and cited it; produced a conclusion-first DIRECT variant; declined to print
its instructions; and described a hostile document's demands as the
document's content without acting on them. The Gemini API rejects JSON
Schema bounds keywords, so the Google adapter strips them at transport
level; Capital Q's Zod schema enforces them on the way back.

## Prompt sizes (rendered, approximate)

| Bundle                                         | System chars | Task chars (fixture input) | Approx tokens  |
| ---------------------------------------------- | ------------ | -------------------------- | -------------- |
| q-system.v1 + company-analyst.v1               | 6,440        | 2,400 to 4,700             | 2,200 to 2,900 |
| q-system.v1 + founder-onboarding-extraction.v1 | 6,440        | 1,900                      | 2,100          |
| q-system.v1 + investor-mandate-synthesis.v1    | 6,440        | 1,800                      | 2,050          |
| q-system.v1 + fit-explanation.v1               | 6,440        | 1,700                      | 2,030          |

The charter is about 1,600 tokens and runs on every call by design.

## Tests

`packages/q-core/test/prompts.test.ts` (registry, lock, immutability,
provider-neutral, no secrets, renderer fences and refusals, sizes, profile
schema rejections, guidance vocabulary, charter principles, fixtures);
`packages/model-gateway/test/q-answer.test.ts` (seam over a fake provider:
SYSTEM/USER split, fences, plan sensitivity, charter marker never stored or
logged, BALANCED vs DIRECT changes only the profile block, invalid output is
a coded failure, synthetic declaration is composition-level only);
`packages/model-gateway/test/providers.test.ts` (Gemini schema adaptation);
`packages/q-orchestrator/test/answer-seam.integration.test.ts` (bundle
version on the run); `apps/q-api/test/q-smoke.live.test.ts` (opt-in live
scenarios and cross-provider identity).

## Developer smoke

`pnpm q:smoke` (after `pnpm build --filter=@capital-q/q-api...` and
`pnpm db:start`) creates a synthetic tenant, founder and company in the
LOCAL database, runs the fixture scenarios through the real stack with
the real providers, prints Q's answers and safe metadata, and removes
everything it made. Flags: `--provider google|groq`, `--preset DIRECT`,
`--scenario <id>`, `--message "..."`. Keys are read by name from
`.env.local` and never printed. The runner declares its inputs synthetic
at composition level; nothing of it is reachable from the public API.

## Explicit deferrals

RAG and real authorised-context assembly → CQ-RAG · Q Knowledge → CQ-KNW ·
tools → CQ-Q-007 · approvals → CQ-Q-008 · SSE → CQ-Q-009 · the eval harness
that consumes these fixtures → CQ-Q-010 · specialists → CQ-Q-020+ ·
user-facing Q Controls and preference persistence → a settings packet ·
proactivity behaviour → continuous intelligence packets · onboarding and
recommendation callers of the extraction, synthesis and fit prompts → their
own packets (the prompts and schemas exist; nothing calls them yet).

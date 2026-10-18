# Public presence (CQ-Q-PRESENCE-001)

What the public web already says about a subject, read once when Capital Q
first knows enough to look, and refreshed rather than rebuilt.

It is a separate thing from the profile a person builds by talking to Q and
uploading documents. That is what they told us. This is what is already out
there. The two are compared, never merged.

## The order

```
due? → the public web, every read at once → each page recorded as evidence
     → a model reads the bounded excerpts → each understanding it proposes
     → the Knowledge Write Gate → the build log
```

`packages/q-presence` owns that order and nothing else. What may leave in a
query belongs to Research, what may be recorded to Evidence, what may be
held to the Write Gate, which model runs to the Model Gateway. Each is a
port; `apps/q-api/src/composition/presence.ts` connects them.

## Is this page even about them?

The hard problem, found the first time it ran against a real name: a search
for "The Vaultlyne" returned an apartment building called The Vault in
Lynn, Massachusetts, and the model — asked what the pages said — reported,
accurately, what a stranger's pages said. Left there, Capital Q would have
held "provides residential apartments" as an understanding about a Nigerian
insurtech company.

So the check is deterministic and it runs before evidence, before the model
and before the gate (`domain/subject-match.ts`). A page is kept only when it
names something distinctive about the subject: a word from their name that
is theirs rather than everybody's ("vaultlyne", not "the" or "ventures"), or
the label of their own domain. Nothing else reaches anything.

It is deliberately strict. A page that genuinely concerns the subject
without ever naming them is lost, and that is the right trade: a missing
understanding is a gap, a wrong one is a lie with a citation. When nothing
survives, the build is `NOTHING_FOUND` and nothing is recorded.

`wrongSubject` in the prompt is a second layer, not the first one.

## What it holds, and what it never does

Every understanding is Q's reading of a cited page: `knowledgeType`
observation, `truthClassProposal` Q_INFERENCE, `automatic: false`. In
practice the gate returns `HELD / INFERENCE_NEEDS_CONFIRMATION` and the row
lands as a CANDIDATE with LOW confidence — a model interpreting public prose
is exactly what CQ-KNW-002 §11 says a person should confirm. Contradictions
survive: a real read held "Wikipedia lists Lagos, LinkedIn lists Sunnyvale"
as one statement rather than choosing.

The key list is closed (`PRESENCE_KEYS`). A key the model could invent would
be a category of understanding with no policy behind it.

`presence.signal.*` is the observed-signal namespace: what a subject
publicly says they focus on, what they publish about, how they present
themselves in their own public writing. Observations about public
statements — never a trait, never a rating, never a number. Every signal key
is in `PRESENCE_KEYS_EXCLUDED_FROM_RANKING`, and a ranking packet that wants
them must change that list deliberately (doc 19 §204.8/§204.9).

Only a subject the actor already owns can be read. A PERSON subject resolves
only to the acting person themselves; the port cannot express "evidence
about somebody else".

## Subjects

Evidence and knowledge were COMPANY-only; doc 14 §2.2 says memory belongs to
"User, Company, Investor, Relationship…". Migration 20260924090000 widens
both `subject_type` checks to COMPANY, PERSON and INVESTOR_ORGANISATION, and
each new type has a registered resolver over its owning domain's query port.

## Refresh

`q_knowledge.presence_builds` records each attempt: status, counts, timing.
No statement, no excerpt, no query, no model output — a read of that table
cannot disclose anything. A completed build is current for 14 days; a
running one blocks a second start for 10 minutes; `force: true` is the
person asking for a refresh.

## When it runs

`apps/q-api/src/voice/presence-trigger.ts`, after an interview turn, once
the setup has both a company name and a bound company. Detached and best
effort: it runs while a person is mid-sentence with Q, so nothing awaits it
and nothing it throws escapes.

A name alone is not enough to look somebody up — every third person shares
one — which is why the trigger waits for a name plus something that
disambiguates it.

## Running it

```bash
pnpm presence:smoke
```

```bash
pnpm presence:smoke -- "Paystack" https://paystack.com
```

A synthetic tenant, organisation and company inside one rolled-back
transaction, then one real build through the whole packet. It spends real
search and model quota, so it is a script and not a test. On 2026-09-16:
Paystack read 7 pages and held 5 cited understandings in 8.5 s; The
Vaultlyne read 10, kept 0, and recorded nothing.

## Not built yet

- A PERSON build has no trigger. The subject, the resolver and the schema
  are in place; what is missing is the moment — arrival knows a name before
  it knows anything that disambiguates it.
- Nothing reads presence back yet. The understandings are CANDIDATE rows;
  confirming them, showing them, and comparing them with what the person
  told Q are the next packet.
- Refresh is time-based only. Nothing re-reads because something changed.

# ADR 0013 — Q artifact preparation is an internal Prepare operation

## Status

Accepted — 2026-09-22.

## Context

QX-003 asks Q to compose a document — an investment brief today, a deck
later — and to keep it, version it and let somebody change it. Writing it
down is the whole point: an artifact nobody can reopen is a chat message.

That collides with three deliberate refusals in the current architecture,
and the collision is real rather than a misreading.

The Tool Registry refuses to register any tool that is not `SAFE_READ` and
`READ_ONLY`, in as many words: _"only SAFE_READ tools can be registered
before the approval engine exists"_ (`packages/q-tools/src/registry.ts`).
So Q cannot be handed a tool that writes.

A specialist is analytical by contract: _"There is no execute, no approval
and no write anywhere in this contract, so a specialist cannot become
consequential by being asked nicely"_ (CQ-Q-020 §51). So the thing that
composes the brief cannot be the thing that stores it.

And every consequential action follows Prepare → Recommend → Human
Approval → Execute. The open question was whether keeping a private draft
is consequential. If it is, every brief needs an approval before it can be
read back, which makes the feature absurd; if it is not, something has to
say so, because "a model caused a row to be written" is exactly the shape
the rule exists to catch.

## Decision

**Persisting a private draft artifact is Prepare, not Execute.** It is
internal to the owning organisation, changes nothing anybody else can see,
asserts nothing as true, and is reversible by ignoring it. No approval is
required to create or revise one.

**The consequential boundary is the moment an artifact leaves the owner.**
Publishing externally, sharing or sending to an investor, submitting it,
attaching it to a Data Room, or adopting it as a material representation of
the company each remain Prepare → Recommend → Human Approval → Execute.
None of them exists yet, and none may be added without going through the
Approval Engine.

**The write happens in one place, and it is not the model's.** The order is
fixed:

```
Q run / orchestration
  → Context Firewall produces an authorised PermittedContextPlan
  → the specialist composes bounded content from that plan's material
  → the artifact application service validates and persists
  → Artifact / ArtifactVersion rows
```

Concretely:

1. **The Context Firewall authorises the input context.** Preparation runs
   inside a real Q run and uses that run's plan. No plan is constructed by
   hand, and nothing reads company material outside one.
2. **The specialist composes; it does not write.** `q-specialists` gains no
   dependency on the artifact context and holds no repository. It returns
   content, as it returns findings.
3. **The artifact application service performs persistence**, behind a
   narrow typed port. It takes the server-resolved actor, the run's plan
   and the run id, and it re-validates all three. It does not accept a
   tenant, an owner organisation or a subject chosen by a browser or named
   by a model.
4. **The Tool Registry stays read-only.** No write-capable tool is
   registered and its guard is not weakened. Q does not decide to persist
   an artifact by calling a tool; the answer seam does it, deterministically,
   after the model has read the person's request into a closed schema field
   (ADR 0011).
5. **An artifact is not canonical truth and not evidence.** Nothing about
   preparation writes to Companies, Investors, Evidence or Knowledge, and
   nothing in discovery, ranking or qualification reads an artifact. A
   statement in a brief stays a statement in a brief unless a later,
   explicit, approved action changes its state.

## Consequences

Q can prepare and revise documents without an approval engine, and without
anybody having to pretend that saving a draft is the same act as sending it
to an investor.

The cost is that preparation is only available where a real Q run and a
real plan exist. There is no "generate a brief" endpoint that skips the
run, and there should not be: the run is what makes the composition
attributable and what bounds what it was allowed to read.

When the Approval Engine lands, the publish/share/send actions attach to it
without changing anything decided here — the Prepare half is already in the
right place, and only the Execute half is missing.

This operationalises the locked Prepare → Recommend → Human Approval →
Execute model. It does not amend it, and no PADL amendment is proposed.

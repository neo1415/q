# ADR 0014 — A hosted synthetic staging deployment may attest its own data

## Status

Accepted — 2026-09-22.

## Context

ADR-adjacent behaviour introduced with the synthetic-demo routing allowance
(doc 15 §62) let a deployment say "everything here was invented", which
makes free inference eligible for material that would otherwise need an
approved provider. The declared sensitivity was untouched; only the
question a provider is asked changed, from _may this vendor hold this class
of customer data_ to _is there a customer here at all_.

That allowance could only ever be built by a deployment whose
`CAPITAL_Q_ENV` was `local` or `test` **and** whose database was loopback.
Both conditions describe a demo stack on somebody's own machine, which is
all that existed when it was written.

CQ-INFRA-STAGING-001 then put api, q-api and workers on Railway against a
hosted Supabase project that holds nothing but invented companies and
invented investors. That deployment is a demo in every sense that matters
and could not say so: `staging` is not `local`, and a hosted database is
not loopback.

The consequence was not theoretical. The hosted interview runs at
`NORMAL_DIALOGUE` / `CONFIDENTIAL`, and with no attestation its routing
decision read:

```
google/gemini-3.5-flash-lite : SENSITIVITY_EXCEEDS_CEILING
groq/openai/gpt-oss-120b     : PROVIDER_TEMPORARILY_FAILING
groq/openai/gpt-oss-20b      : PROVIDER_TEMPORARILY_FAILING
groq/qwen/qwen3.8-27b        : PROVIDER_TEMPORARILY_FAILING
google/gemini-3.8-flash      : SENSITIVITY_EXCEEDS_CEILING
```

Zero eligible routes. Q spent an entire conversation saying "I'm having
trouble thinking just now" and reading a bare field label back at somebody
who kept answering it.

## Decision

**A hosted deployment may attest that its data is synthetic, and staging is
the only hosted environment that may.**

The attestation is built only when all of these hold:

1. the operator has opted into synthetic routing for this deployment;
2. `CAPITAL_Q_ENV` is `staging`;
3. `CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED` is explicitly true — the deployment
   stating that there is no customer here, which is a different claim from
   the routing preference in (1) and is therefore a different variable;
4. `CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF` names a Supabase project, and
   every project identifier this process can see — from its database URL
   and from `SUPABASE_URL` — is that project;
5. the individual request still declares `dataPosture: SYNTHETIC_DEMO`.

`local` and `test` keep the loopback rule exactly as it was.

**`preview` and `production` refuse the attestation outright, and refuse it
loudly.** A process that carries it there throws at startup rather than
beginning and routing quietly — including when the routing opt-in is
absent, because a deployment that believes it is a demo and serves real
people is a configuration fault whichever way round the flags are.

Condition (4) is why this is an identifier rather than a boolean. A boolean
says "trust me"; naming the project means an operator has to state which
data they are vouching for, and a staging service later repointed at
another database stops attesting at startup instead of sending a real
customer's material to a free provider.

## Consequences

Hosted staging can now hold a conversation when one free tier is spent,
because Gemini becomes an eligible route for material the deployment has
said is invented.

**Nothing about classification changes.** A RESTRICTED synthetic payload is
still RESTRICTED, travels as RESTRICTED, and is logged as RESTRICTED. The
only thing the attestation moves is provider eligibility, and only for
requests that declare the posture. A `REAL_CUSTOMER` request on an attested
staging deployment routes exactly as it does in production.

**No browser can reach any of this.** The posture is a field on the
internal gateway request; no HTTP contract carries it, and the attestation
is server-side configuration. A declared posture with no attestation
changes no route, which the existing tests already hold.

The cost is one more thing an operator can get wrong, and the mitigation is
that every way of getting it wrong fails at startup with a named reason
rather than degrading into a quieter routing decision.

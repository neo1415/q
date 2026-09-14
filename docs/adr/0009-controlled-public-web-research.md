# ADR 0009 — Controlled public-web research through the Tool Registry

**Status:** Accepted (CQ-Q-RESEARCH-001)
**Clarifies:** Document 12 §34.3 and §41 (a controlled research tool is admissible; an unbounded HTTP tool is not), Document 16 (egress, injection and SSRF threats), the Company Intelligence ports note that "external research is a later governed source layer" (CQ-Q-020 §46), ADR 0008 (untrusted text is data).

## Context

Q could reason only over what Capital Q already held: canonical company state,
authorised Q Knowledge and the person's own documents. A founder asking "what does
the public web say about us?" or an investor asking about a network-visible company
got an honest "I have no public sources", and a discrepancy between a company's
record and its public footprint could never surface in the conversation where it
would be settled.

Two locked rules constrain the answer. The Tool Registry admits no SQL tool and no
arbitrary HTTP tool: a tool that fetched whatever URL a model named would let the
model, or a page, decide Capital Q's reach. And nothing a model or a page says is
truth: a search result is not a claim, a claim is not canonical state, and a
contradiction is not proof.

The distinctions that constrain the design:

```
public web source ≠ verified fact
search result ≠ Claim ≠ canonical state
model interpretation ≠ truth
Unknown ≠ negative
contradiction ≠ proof
retrieved page text ≠ instruction
```

## Decision

1. **One provider-neutral research capability, `@capital-q/q-research`.** It exposes
   two operations — search and extract — behind a port. The only file that imports
   the vendor SDK (`@tavily/core`) is its Tavily adapter; the eslint boundary rule
   forbids the SDK everywhere else, and a boundary test keeps the research package
   itself out of the web app, q-core, contracts, the domains and onboarding. Tavily
   Research, Crawl and Map are not used.

2. **Bounded by construction.** At most two search calls (the second only as a
   refinement when the first returns nothing), at most five results considered, one
   extract call for the top one to three results (hard bound five), two thousand
   characters of excerpt per source, at most two sources per domain.

3. **An outbound egress firewall composes the query; the model does not.** What
   leaves Capital Q is assembled from an allow-list: tokens of the person's own
   latest message (figures dropped), the subject's _authorised_ public identity (a
   network-visible or public name, a declared website), and a short list of neutral
   connectives. A model's requested query contributes only tokens that survive that
   list. A private company with no declared website has no public identity: its name
   never leaves, the person's words alone are searched, and Q is told to ask before
   naming it. The private markers `CQ_PRIVATE_DO_NOT_EGRESS_94731` and
   `CQ_INVESTOR_PRIVATE_DO_NOT_EGRESS_55120` are hard tests: they never reach the
   provider, a log, a metric or an error.

4. **URL safety is a type, not a hope.** Extract accepts only URLs a search in the
   same run surfaced (a per-run allow-list), and only public `http`/`https`
   destinations: loopback, RFC1918, link-local, CGNAT, multicast, IPv6 local and
   IPv4-mapped forms, cloud metadata hosts, `.local`/`.internal` suffixes, bare IP
   literals, embedded credentials and non-web schemes are refused with a reason and
   nothing is sent.

5. **Retrieved text is data.** Excerpts are scanned for instruction-shaped passages
   (a count travels with the source as data about the page), rendered inside the
   untrusted fence, and never reach a system message. The Company Intelligence
   specialist offers the model no tools at all; the conversational seam offers one
   tool round, so a page can never cause a call.

6. **Persistence reuses the Evidence architecture.** A source a founder's Q reads
   about their own company becomes an `evidence.sources` row of type `PUBLIC_WEB`
   (provider code, URL, title, retrieval time, publication time only when the
   provider dated it, `SECONDARY_EXTERNAL` reliability, `organisation_private`
   visibility, `INTERNAL` sensitivity, sparse metadata) with one `evidence_items`
   excerpt, deduplicated by URL and by excerpt hash. No `q_web_results`, no
   `tavily_results`, no `web_memory`, no `research_truth`. No claim is minted from a
   page; truth class stays `UNKNOWN`. Research about a company the actor does not own
   (an investor reading a network-visible company) is transient, because the Evidence
   owner registers sources only for the owning organisation and `COMPANY` is the
   only evidence subject type — widening either is a migration this ADR does not
   make.

7. **Comparison is deterministic and uses existing vocabulary.** The research
   capability compares each source with the subject's authorised record — own
   website, geography mentions against the recorded headquarters, whether the source
   names the company at all, and how old it is — and emits notes with a relationship
   from `SUPPORTS`, `QUALIFIES`, `CONTRADICTS`, `INSUFFICIENT_INFORMATION`, `UNKNOWN`.
   An extra country is `QUALIFIES`, never `CONTRADICTS`: a company may operate in more
   places than its headquarters. A `QUALIFIES` or `CONTRADICTS` note makes the
   specialist instruct the model, deterministically, to end with one clarifying
   question rather than settle the difference.

8. **The specialist decides when to research, from the person's words.** Company
   Intelligence gains a fourth narrow port, `CompanyResearchPort`, over the Tool
   Registry, called like the canonical read — before the model is asked anything,
   and only when `asksForPublicResearch(question)` finds a public-facing cue (the
   web, the press, a website, competitors, "look it up"). The registry decides
   whether _this run_ may have it; a run without the actor-wide
   `PUBLIC_EXTERNAL_DATA` scope, or a composition without a provider, gets "not
   offered" and Q says public sources were not checked. Sources enter the prompt as
   `PUBLIC_EXTERNAL_DATA` facts with truth class `UNKNOWN` and evidence status
   `SELF_REPORTED` (the company's own website) or `NO_EVIDENCE` (anyone else), so a
   page can never raise Capital Q's information confidence and a model finding that
   cites one is bounded to that status. Label references such as "(source S1)" are
   rewritten into title, domain, date and link before a person reads them.

9. **The person's clarification is their claim, persisted through the gate.** The
   analyst may return `userStatements` whose `quote` must occur verbatim in the
   person's own message; the conversation statement recorder refuses anything else,
   registers a `USER_STATEMENT` source (`founder_private`, `CONFIDENTIAL`, external
   reference `q-run:<id>`) with one item carrying the quoted words, and submits a
   `USER_CLAIM` candidate to the Knowledge Write Gate under
   `USER_CLARIFIED_IN_CONVERSATION`. It lands `ACTIVE` at `SELF_REPORTED`/`LOW`, is
   retrieved in a later conversation as Capital Q's current understanding with the
   provenance "stated by the person in a Q conversation", and changes no canonical
   company field. The answer acknowledges what was recorded in Capital Q's words.

10. **Configuration.** `TAVILY_API_KEY` is read only by q-api from the root
    `.env.local`, wrapped as a `ProviderCredential` (serialises to `[redacted]`),
    revealed once at composition, absent from the web configuration and from every
    log; configuration reports presence only. Without it the research tools do not
    exist.

## Consequences

- Q can research, compare, ask and remember without a second chatbot, a second truth
  store or a report generator. The same Q, the same Evidence, the same Knowledge.
- The provider is replaceable: the port is search/extract with Capital Q's own DTOs;
  no request id, status code or endpoint reaches a caller, a log or a person.
- Cost is bounded per run and observable (`q.research.*` metrics carry counts and
  provider code only).
- A visible stage `SEARCHING_PUBLIC_SOURCES` exists in the contract and has a web
  label, but `q_runtime.run_events` still enforces the original stage list in a
  CHECK constraint. Widening it is a migration this packet deliberately did not
  create; until it lands, research shows as `CHECKING_EVIDENCE`.
- Research about a non-owned company is transient (see Decision 6). Recording it
  would need an evidence subject or ownership rule the Evidence owner does not have.
- Voice, recommendations, GateQ, connectors and Tavily Research/Crawl remain outside
  this decision.

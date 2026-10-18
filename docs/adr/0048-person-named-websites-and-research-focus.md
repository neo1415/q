# ADR 0048: A website the person names may be read; research tools always reach a research turn

Status: Accepted (lead 2026-10-04). Amends ADR 0009 rule 4.

## Context

Run 13955ca2 (Zino, 2026-10-03 21:15 UTC): "read my website" was read as
`RESEARCH_REQUEST` with research `EXPLICIT`, but the tool focus for an
own-company question ranked 81-85 tools before the 40-tool bound and the three
public-web tools sat past it. Q answered that it had no public-web result.
Separately, `extract_public_web` accepted only URLs a search in the same run
surfaced, so "read zinoaviation.com" could never be read even when offered,
and a bare domain did not parse.

## Decision

1. When the turn reader says research `EXPLICIT` or `OFFERED`, the kind is
   `RESEARCH_REQUEST`, or the person's words contain a URL or a domain,
   `research_public_web`, `extract_public_web` and `lookup_public_profile`
   join the focus's named tools, so they lead the offer and no bound cuts
   them. Offering is not authority: the plan's purpose and the
   `PUBLIC_EXTERNAL_DATA` scope still decide whether they execute.
2. ADR 0009 rule 4 gains one source: extract also accepts a web address the
   person wrote in their own latest message (from the run's conversation, never
   a model argument alone). Every URL, from either source, is still judged by
   `judgePublicUrl` first; private, loopback, link-local, metadata, bare-IP,
   credentialed and non-web-scheme addresses stay refused.
3. A written address is normalised (`normaliseWebAddress`): trimmed, wrapping
   punctuation removed, host lower-cased, no scheme or `http://` read as
   `https://` first with the `http://` form as the single fallback. The brand
   reader applies the same normalisation to the website on record.

## Addendum (same day): the tool limit is the provider's, and nothing is unreachable

Founder: "increase the tool limit... make sure that Q is able to get all its tools
whenever it needs them". Decision:

4. `MODEL_TOOLS_MAX` is 128, the documented per-request function limit of OpenAI
   and Gemini. The per-turn bound (`Q_TURN_TOOLS_MAX`, 40 since 2026-10-02) is
   127: staging logs on gpt-5.6-luna showed no latency cost from 40 to 80 tools
   (median round 2.9-4.2 s at 40, 2.4-3.1 s at 78-80); the 93-tool catalogue's
   schemas are about 97k characters in all. The focus still narrows by
   relevance, for cost.
5. `use_capability` (core, SAFE_READ) loads any tool the run's `available` list
   holds (purpose, plan scopes and actor; the same list that decides what may
   execute) by name or need. The gateway adds what it returned to the offer and
   to the focus's named tools for the next step of the same turn (one extra
   round, once), and logs `q.capability_loaded`. A tool the plan does not
   allow is never returned and never offered.
6. Guaranteed in focus: named actions, research (EXPLICIT, a research request,
   a URL; OFFERED keeps the three tools without adding the area), navigation
   (core), and the previous turn's tools on "try again".

# ADR-001 — Cross-Document Canonical Vocabulary and Behaviour Clarifications

**Status:** Accepted — 2026-09-02
**Clarifies:** Documents 12, 13, 14, 18, 20
**Overrides:** nothing in the locked PADL, Product Specification or Final System Review

## Context

Five contradictions exist between architecture documents. Each is a place where two documents describe the same concept with different vocabulary or different behaviour. Left unresolved, independent implementation packets would each pick a different answer and the divergence would harden into the schema, the design system and the retrieval layer.

This ADR fixes one canonical answer per item. It clarifies existing documents rather than changing any locked product decision, and it exists so that no later packet has discretion to invent its own vocabulary. The five source documents are not rewritten during the MVP sprint; this ADR is the authority for the delta.

## Decision 1 — Visibility / disclosure scopes

**Governing locked decisions:** PADL #144 (isolated party contexts), PADL #146 (permission-aware source visibility).

One canonical eight-value vocabulary. Document 12 supplies the semantics; Document 13 supplies the persisted `snake_case` representation.

```
personal_private
organisation_private
founder_private
investor_private
relationship_shared
specifically_shared
network_visible
public_external
```

Reconciliation:

- Document 13's final value `public` becomes `public_external`.
- Document 14's `Individual Private` is an explanatory synonym for `personal_private`, not a distinct scope.
- Document 14's combined `Network / Public` splits into `network_visible` and `public_external`.

The last distinction is load-bearing and must not be collapsed again: content can be visible to authenticated Capital Q network participants without being public at an external URL.

## Decision 2 — Truth, evidence and lifecycle

**Governing locked decision:** PADL #139, which requires Q to distinguish verified, document-supported, user-provided, estimated/assumed, inferred, unknown and disputed/contradictory information while preserving time and version history.

Document 14 is correct that truth quality and lifecycle must not share one enum. Document 13's `claims.truth_state` currently merges them and is superseded here.

Three independent axes:

```
truth_class
  VERIFIED
  USER_CLAIM
  ESTIMATE
  Q_INFERENCE
  UNKNOWN

evidence_status
  NO_EVIDENCE
  SELF_REPORTED
  DOCUMENT_SUPPORTED
  MULTI_SOURCE_SUPPORTED
  EXTERNALLY_VERIFIED
  PLATFORM_VERIFIED

lifecycle_status
  CURRENT
  HISTORICAL
  SUPERSEDED
  DISPUTED
  CONTRADICTORY
  STALE
```

This refines Document 14 as written: `DOCUMENT_SUPPORTED` belongs to evidence support only and is removed from the truth-class axis, so the concept exists once rather than twice. PADL #139's "document-supported" state is fully represented by `evidence_status = DOCUMENT_SUPPORTED`.

`verification_claims` remains a separate workflow and table covering identity, organisation affiliation and domain control. It must not be collapsed into these three axes.

## Decision 3 — Design tokens

`--cq-*` is the canonical prefix. Document 18 §§7–9 contain the implemented token architecture and the complete V1 palette.

```
--cq-canvas
--cq-surface
--cq-surface-raised
--cq-text-primary
--cq-border-subtle
--cq-accent
--cq-positive
--cq-warning
--cq-danger
...
```

Document 18 §148's `--color-*` examples are an internal inconsistency within that document, not a second token system. Read §148 as requiring semantic names, not as prescribing a prefix.

No dual aliases. Do not introduce both `--cq-text-primary` and `--color-text-primary`.

## Decision 4 — Retrieval

These are two different architectures and are named separately. Document 12 describes source authority; Document 14 owns the detailed retrieval design and describes execution.

```
SOURCE AUTHORITY
authoritative structured state
→ governed knowledge
→ authorised private evidence/context
→ connected knowledge
→ public/external evidence
→ general model knowledge

RETRIEVAL EXECUTION
resolve authorization
→ structured lookup
→ knowledge-object lookup
→ hybrid lexical + semantic source retrieval
→ relationship/temporal retrieval when relevant
→ connected/public retrieval if permitted
→ rerank
→ evidence expansion
→ context assembly
```

Lexical and semantic retrieval are parallel components of one hybrid step, not a sequential hierarchy. Document 14 specifies Postgres full-text search plus pgvector combined with reciprocal rank fusion.

Authorization resolves before retrieval in every case. There is no global similarity search followed by application-layer filtering of unauthorised results.

## Decision 5 — Reduced motion and pitch video autoplay

Normal Discover behaviour is unchanged: the active pitch item autoplays muted, and audible autoplay is never permitted.

When `prefers-reduced-motion: reduce` is active:

```
pitch video remains available
BUT automatic playback is disabled

show poster + explicit Play control
user-initiated playback works normally
audio stays off until explicitly enabled
decorative/background video never autoplays
```

This resolves the ambiguity between Document 18 §125 ("do not automatically disable the pitch video itself") and Document 20 §129 ("autoplay may become more conservative"). Reduced motion disables automatic motion, not access to video content.

## Consequences

- Documents 12, 13, 14, 18 and 20 are clarified, not rewritten. This ADR is the authority for these five items until those documents are revised.
- Implementation packets touching visibility scopes, the evidence/claims schema, design tokens, Q retrieval, or the feed must follow this ADR and may not substitute their own vocabulary.
- `CQ-CON-001` does not need redoing. None of these five items affects the shared money, ID, timestamp or pagination primitives.
- This ADR must be in place before `CQ-SEC-001`, the evidence/claims schema packet, the Q retrieval packets, and the design/feed packets.
- The "Open Architecture Conflicts" section previously carried in `CLAUDE.md` is removed and replaced by a reference to this ADR.

## References

- `docs/product-sources/Real PADL - Capital Q Product Architecture Decision Log.docx` — Decisions #139, #144, #146
- `docs/architecture/12_Q_Technical_Architecture.md` — §15.4 context labels, §17.1 source precedence
- `docs/architecture/13_Capital_Q_Database_Data_Architecture.md` — §22.1 claims, §26.1 `scope_type`
- `docs/architecture/14_Capital_Q_RAG_Memory_Knowledge_Architecture.md` — §2.5 scopes, §22 retrieval, §40–42 truth/evidence/confidence
- `docs/architecture/18_Capital_Q_Visual_Design_System_Interaction_Architecture.md` — §§7–9 tokens, §125 reduced motion, §148 token naming
- `docs/architecture/20_Capital_Q_Video_Feed_Performance_Architecture.md` — §129 autoplay policy

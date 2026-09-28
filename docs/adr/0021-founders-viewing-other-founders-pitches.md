# ADR 0021 — Founders viewing other founders' pitches

## Status

Proposed — 2026-09-28. **Waits on the founder's decision.** Founder live
test 2026-09-28 item 12 asked that founders can view other founders'
pitches. The product sources neither grant nor forbid it; this ADR
records why it is a disclosure decision and proposes the smallest design
that keeps the existing invariants.

## Context

- PADL Decision #98 (LOCKED) makes discovery bilateral: _investors discover
  companies; founders discover investors._ Decision #99 (LOCKED) makes the
  short-form video feed an **investor** discovery surface; founders "may
  similarly discover investor content". Neither mentions founders watching
  other companies' pitches.
- Playback today is decided by one rule (`packages/media`,
  `createResolvePlayableAsset`): the owner, or a viewer the investor feed's
  own discoverability rule would show the company to. A founder is never
  that viewer.
- When a founder made their company discoverable, they chose visibility to
  **investors**. Other founders on the network can be direct competitors.
  Widening the audience of a pitch they already published, without asking
  them, would change a disclosure after the fact — the kind of silent
  widening the Context Firewall and visibility scopes exist to prevent
  (`CLAUDE.md`: UI hiding is not authorization; visibility scopes are
  explicit, ADR-001).

## Proposed decision

1. **Opt-in per company, off by default.** A new owner setting on the
   pitch, "Other founders can watch this pitch", separate from the investor
   playback policy. Existing pitches stay investor-only until their owner
   turns it on. The setting is stored, audited and revocable like the
   playback policy.
2. **One playback rule, extended, not a second one.** The viewer path gains
   a founder branch: an authenticated founder may play a pitch only when it
   is publishable (current, READY, moderation ALLOWED, policy not PRIVATE)
   **and** its owner opted in. Every refusal stays "not found".
3. **A browse surface for founders**, read-only: pitches from opted-in
   companies, no ranking by views, no counters, no interest actions (a
   founder cannot express investor interest), no Q assessment of the other
   company beyond its network-visible profile.
4. **Founder-private information never flows**: only network-visible
   profile fields show beside the pitch.

## Alternatives

- _All discoverable pitches visible to all founders._ Simplest, but widens
  every existing founder's disclosure without consent. Rejected unless the
  founder explicitly decides that "discoverable" means "to everyone on
  Capital Q".
- _Do not build._ Keeps PADL #98/#99 exactly as written.

## Consequences

Needs a migration (the opt-in column on the pitch/media policy), a contract
change (owner setting + founder browse endpoint), a media-service rule
change with positive, cross-tenant-negative and opt-out-negative tests, and
a web surface. Not started until the founder chooses between the proposal
and the alternatives.

# ADR 0063: What a pitch says is read from its transcript, under the playback rule

Status: Accepted (2026-10-08, lead, under the founder's standing approval). Facts are computed on read under the video's own playback check and never stored; a stored path needs its own ADR.

## Context

The founder: "the overview says how much they're raising isn't shared, whereas they literally say it in the video". Every live pitch already has a stored transcript (`media.pitch_transcripts`, Cloudflare Stream generated captions, written by the API's caption sweep on upload and as a backfill; 34 of 34 live pitches on 2026-10-08). Nothing read the transcripts for the overview, and Q could only read the moment of a pitch being watched.

The packet asked for the facts to go through the Knowledge Write Gate as USER_CLAIM / SELF_REPORTED with visibility following the video's.

## Decision

1. `@capital-q/media` reads claims from a transcript deterministically (`extractPitchClaims`, reader version 1): the raise (money only with a said currency), stage, instrument, traction clauses, use of funds, each with the cue time it is said at. No model, no cost, same output for the same transcript.
2. The claims are a view of the transcript, computed on read and never stored. They reach a reader only through `getPitchTranscript`, i.e. exactly the playback rule (R18: the transcript is part of the pitch). Each is labelled USER_CLAIM, SELF_REPORTED, source PITCH_VIDEO, with pitch id and moment.
3. Raise precedence on the profile: a declared raise disclosed to the reader wins (a different figure said in the pitch stays beside it); a founder who revoked a share of the raise has hidden it, so no raise from a pitch is shown either and the owner is told the video still says it; otherwise the raise as said in the pitch, labelled so. Unknown sharing is treated as hidden.
4. Q reads the same through `read_company_pitches` (plan admits the company first, playback rule per pitch).

## Deviation flagged: not through the Knowledge Write Gate

Writing these into `q_knowledge.objects` would need either a platform actor with evidence-write authority (none exists; inventing one widens authority) or a visibility scope derived from the narrowest input. A pitch's audience is decided by the media playback rule (owner policy, audience, investor eligibility), which none of the eight scopes expresses: `network_visible` would leak an investors-only pitch's words to founders, and `founder_private` would hide them from the investors who may watch the video. Computing on read under the playback rule keeps the invariant exact and leaves nothing to go stale. If the lead wants persisted knowledge (e.g. for cross-company retrieval), the follow-up is a `pitch_video` evidence source whose read is resolved by the media context, not by a scope enum.

## Consequences

No migration, no backfill job and no provider spend for claims. A transcript the provider never produced stays unknown ("Nothing stated in their pitch yet", never zero). Founders can still hide their raise; the video itself remains theirs to replace.

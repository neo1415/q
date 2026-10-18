# ADR 0022 — Several live pitch videos per company

## Status

Accepted — 2026-09-28, founder decision ("like TikTok, where a user can
upload multiple videos and, as the owner, edit each video, and they are
online at all times unless deleted"). Amends doc 20 §8 and §19 (one primary
pitch per company). Migration `20261022090000_media_multiple_pitches`.

## Context

Doc 20 made a company's pitch a single primary asset, enforced by the
partial unique index `media_assets_current_pitch_idx`: a second upload had
to replace the first. Founders want to post several videos (a pitch, a
product demo, a team intro, a traction update) and keep each online until
they delete it.

## Decision

1. **Several live videos.** A founder pitch asset is live while it is not
   deleted and not superseded. Uploading without naming a predecessor adds
   another live video; the single-primary index is dropped. A company may
   have at most 30 live videos (`LIVE_PITCHES_MAX`), a bound rather than a
   target.
2. **Replacement stays, per video.** Re-uploading one video still creates a
   successor and supersedes exactly that video, under its row lock, keeping
   lineage (`media_assets_replaces_idx`, one successor per predecessor), its
   title and its audience.
3. **Each video has an owner-set title and audience** (`title`, `audience`
   columns; audience per ADR 0021). Changing either is `media.manage`,
   versioned and audited, like the playback policy.
4. **Ranking stays per company.** Discover still ranks and shows one item
   per company (doc 19). The item leads with the company's newest
   publishable video and carries the others (`morePitches`); the person can
   step through them. More videos never mean more reach: nothing counts
   views, and the number of videos is not a ranking input.
5. **Playback is still decided per video** by the one rule in
   `createResolvePlayableAsset`: the owner, an investor the company is
   discoverable to (any publishable video), or — for a NETWORK video only —
   any signed-in participant while the company is network-visible.
6. **"Current"** in the media service now means the newest live video; the
   company profile leads with it.

## Consequences

- The owner's Pitch & media page is a grid of live videos, each with its
  own page (publish, name, audience, replace, preview, delete).
- Existing data is unchanged: every existing pitch is one live video with
  audience INVESTORS.
- Q's pitch-moment context (R18) keeps working per `mediaAssetId`.

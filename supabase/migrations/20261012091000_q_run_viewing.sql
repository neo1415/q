-- CQ-MEDIA-TRANSCRIPT (R18) · What the person was viewing when they asked.
--
-- "Q watches the video with us": a question asked from Discover while a
-- pitch plays carries the pitch and the playback position, so Q can answer
-- about "now = 1:42 in this pitch". It is an input, never authority: the Q
-- runtime re-authorises the pitch for the asking person (the same rule the
-- playback token uses) before anything is read, and a pitch they may not
-- play is simply not there.
--
-- A run-level column rather than a subject: the position is a moment in
-- the conversation, not something the conversation is about, and it must
-- not carry forward to the next turn the way subjects do.

alter table q_runtime.runs
  add column viewing jsonb check (
    viewing is null
    or (jsonb_typeof(viewing) = 'object'
        and length(viewing::text) <= 256
        and viewing ->> 'kind' = 'PITCH_PLAYBACK'
        and viewing ? 'companyId'
        and viewing ? 'mediaAssetId'
        and viewing ? 'positionSeconds'));

comment on column q_runtime.runs.viewing is
  'The pitch and playback position the question was asked at (QViewingMoment); null when none, or when the Q API did not authorise it for the asker. Never a grant.';

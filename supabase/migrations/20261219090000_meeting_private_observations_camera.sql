-- 2026-10-08 (founder: "can Q see the camera too"): with camera vision on
-- (RECALL_CAMERA_VISION=on), Q's private notes may also come from a camera
-- tile -- behaviour, setup and objects only, never appearance or identity.
-- Same table, same owner-only RLS; frames are still never stored.
-- Fix forward: widen the source check; existing rows are all SCREEN_SHARE.

alter table communication.meeting_private_observations
  drop constraint meeting_private_observations_source_check;

alter table communication.meeting_private_observations
  add constraint meeting_private_observations_source_check
  check (source in ('SCREEN_SHARE', 'CAMERA'));

comment on table communication.meeting_private_observations is
  'Q''s private written observations of screens shared (and, when camera vision is on, cameras) in a call, for the assistant''s owner only. Never shown to other participants or included in recaps. Append-only; no frames stored.';

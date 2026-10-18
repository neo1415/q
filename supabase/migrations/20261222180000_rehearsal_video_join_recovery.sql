-- Recover the same private room across replicas without storing a plaintext
-- participant credential. Existing owner-only server access remains unchanged.
alter table q_runtime.rehearsal_video_sessions
  add column sealed_join_url text check (
    sealed_join_url is null or length(sealed_join_url) between 40 and 16000
  );
comment on column q_runtime.rehearsal_video_sessions.sealed_join_url is
  'AES-GCM encrypted private join URL; authenticated data binds tenant, user and video session. Never returned as ciphertext or logged.';

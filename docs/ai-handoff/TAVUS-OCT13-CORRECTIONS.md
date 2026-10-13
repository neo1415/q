# Tavus PR 39 continuation — October 13

This continues the existing video rehearsal slice; Q's canonical rehearsal
service remains the interviewer intelligence, transcript and review owner.

Local targeted verification: 30 session/route tests passed on the fresh authorization guard;
19 account/refusal, 12 adapter and four UI tests passed unchanged in the preceding
four-file run. No provider calls. Package build passed 52/52; capability-parity passed 11 tests. Full types and
release CI/migrations/deployment remain separate gates.

Implemented focused safeguards:

- Only one provider account is instantiated. An explicit `TAVUS_API_KEY`
  takes precedence; a legacy `CQ_TAVUS_API_KEYS` list is accepted only if it
  resolves to one key. Credit, quota and auth refusals never rotate accounts.
- Test mode uses `CQ_TAVUS_TEST_MODE=true`. Outside test mode, paid allocation
  additionally requires the actor's canonical profile UUID in
  `CQ_TAVUS_PAID_USER_IDS`; an empty set fails closed to existing voice.
  This controls initial paid acceptance; it is **not a monthly budget ledger**.
- Immutable migration `20261222175000` remains unchanged. New additive migration
  `20261222180000` stores an encrypted private join URL in the existing session
  table. Existing TokenCipher AES-GCM is reused; HKDF derives a separate purpose
  key from the stable existing voice-session server secret. Authenticated data
  binds tenant, owner and session. No plaintext provider token is persisted.
  All replicas must share the existing stable server secret.
- Reads and repeated starts recover the same room after a restart. They never
  allocate another room or extend the fixed 180-second creation deadline.
  If provider setup consumes that deadline, no paid conversation is allocated.
- Every bridge request, including cached retries, revalidates the stored actor
  through active profile, uncached suspension and the canonical actor resolver.
  The resolved tenant/user/organisation/membership must match exactly.
  Revocation or failed admission also prevents background review model calls.
- Unconfirmed provider end does not close the canonical session or finish its
  review. A failed end can recover only through an authoritative provider
  read explicitly reporting ended. The sweep retries at the existing deadline. ENDED non-voice rows
  whose canonical rehearsal remains ACTIVE are also selected for review retry.
- A closing-soon notice is shown during the last 30 seconds. This is a UI
  notice, not proof of a spoken closing cue.

Remaining limitations to verify or correct before broad rollout:

- ADR 0066's monthly provider spend admission guard is absent; the initial
  paid-user allowlist is deliberately narrow. Do not enable broad paid access.
- Provider creation does not persist an intermediate PAL checkpoint before
  conversation creation; a process crash during allocation can orphan objects.
- Bridge retry deduplication and its 60-line count are process-local; a restart
  can repeat a turn. Existing canonical rehearsal ownership still binds reads.
- Timing starts at allocation, not a provider participant-joined callback;
  startup reduces the founder's available time. The current cap is deliberately
  not extended without reviewing the provider backstop.
- A provisional canonical review is not an intelligent final review. Actual
  acceptance must inspect its provisional flag and saved transcript.
- Test-mode conversation creation is not audiovisual acceptance. The initial
  founder journey still requires real remote video/audio, Q-backed replies,
  transcript, confirmed provider close and saved nonprovisional review.

Provider keys, room URLs, participant tokens and private acceptance artifacts
must not be committed. The release owner coordinates provider configuration,
CI, both migrations, deployment and paid acceptance to avoid duplicate calls.

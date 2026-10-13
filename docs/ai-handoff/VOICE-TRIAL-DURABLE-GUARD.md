# Cumulative active-speech trial guard — October 13 continuation

## Scope and canonical records

The two already configured trial profiles each retain a 300-second cumulative allowance. Speech from the person or Q counts as a union, and idle silence does not count. Existing `q_runtime.voice_live_trial_usage` remains the only consumption record. The new `voice_live_trial_claims` is exclusive coordination for that same global profile, rather than a second allowance or voice service.

## Protected sources and release status

The previous unfinished lifecycle guard is preserved and pushed as `71518a20` on `codex/voice-trial-audit-takeover`. This is explicitly WIP; do not promote it independently. The durable helper source is `7a80872a259e94d1f21197e4c9d1e28947df29d1` on `codex/voice-trial-durable-claim`.

The combined continuation branch is `codex/oct13-voice-trial-guard`, based on integration `6f47fd5d032b8a218904c53641a9928549c07075`. It ports the existing bootstrap, alternative-provider, accounting and durable-claim work. `19b84f74` additionally bounds observer readiness to five seconds, withholds usable SDP until observation is confirmed, and refuses an OPEN response if observation fails while context is loading.

Migration `20261222170000_q_voice_live_trial_claim.sql` is NOT APPLIED by this lane. It must pass exact-head CI including its 26 pgTAP assertions and schema guard before the release owner applies it. No paid provider call or live quota/audio acceptance was performed here.

## Required lifecycle guarantees

- Claim admission locks the existing global user profile before reading canonical usage; another process, device or owned tenant cannot reserve the same remainder.
- A claim never expires merely because time passed. A crashed or ambiguous session stays unavailable until actual provider termination and accounting are established.
- Final canonical usage and true server `session.closed` confirmation are required to release a created session. Browser final reports and ordinary WebSocket close are insufficient.
- Observer loss immediately ends the line, excludes future idle time from consumption, and retains the claim because unobserved speech is unknown.
- Definitive provider creation rejections may release a zero-use claim; network, parsing and server failures retain it.
- Trial bootstrap issues only a sealed local LIVE binding. It mints no alternative paid credentials; duplex fallback, adoption and relay endpoints reject configured trial owners.
- Regular non-trial voice access and fallback are preserved.

## Regression and real acceptance

The original concurrent regression (290 already used, two independent brokers each trying eight seconds) is restored without weakening its total <=300 assertion. Additional cases cover immediate 299-second reconnect, write failure, global account scope, provider termination, continuous speech and failed/pending observer readiness.

Local and CI results belong in the release checkpoint after they finish. Provider event validity, actual audiovisual output, real silence exclusion and physical termination timing remain live checks; mocked admission and meter tests cannot establish those. The current one-second meter tick and asynchronous provider-close confirmation are not proof of zero-millisecond physical cutoff.

Use existing authorized accounts and protected session helpers. Do not spend the full trial allowance for routine verification, reset actual consumption, switch provider accounts to bypass quotas, apply the superseded browser-meter prototype migration, or expose credentials/private receipts in Git.

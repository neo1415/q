# Tavus pilot readiness

Current repaired deploymentf4c2e603 all-four SUCCESS/drained. Explicit Video lobby browser PASS (Video preselected/Steve checked/Join enabled; Join not clicked); human retry link sent. Single paid <=180second pilot authorized, engineer has allocated no room. Human audiovisual acceptance remains pending.

Human join failed: correct admitted Tensorgate profile saw no Video selector and entered a refused voice rehearsal. No Tavus room allocated. One paid <=180-second pilot remains authorized but NOT human audiovisual accepted. Repair and verify the browser join path before retrying.

Release prerequisites (root owner): exact latest PR44 quality+database CI green; immutable migration 20261222175000 then additive 20261222180000 applied before code; exact q-api/web deployed SHA verified. One q-api replica; one explicitly entitled provider key. Stable existing voice-session secret across service instances. Q_API_PUBLIC_URL must equal the reachable HTTPS q-api origin.

Canonical admission is CQ_TAVUS_PAID_USER_IDS in BOTH test and paid modes after the refresh/admission fix. Use the canonical identity.user_profiles.id, never Supabase auth user id. Confirm active profile, active selected organisation_membership, exact tenant/membership and latest unsuspended account state. Root must obtain Railway settings read-only and reduce private variable results to booleans/counts only. Count running q-api replicas in the live service instance/multi-region configuration; do not infer replicas from deployment count. Keep configured and observed runtime evidence separate.

Safe read-only local backend checker (no creation, finish, direct provider calls or changes):

NODE_USE_ENV_PROXY=1 CQ_TAVUS_SESSION_FILE=<private existing founder session> CQ_TAVUS_ORGANISATION_ID=<canonical organisation UUID> CQ_TAVUS_CONFIG_RECEIPT_FILE=<sanitized root receipt> CQ_TAVUS_REHEARSAL_ID=<existing rehearsal UUID, optional> node scripts/handoff/live/tavus-readiness.mjs --read

Sanitized receipt fields:
observedAt, expectedCodeSha, actualCodeSha, testMode, replicas,
keyCount, keyPresent, paidProfileCount, paidProfileIdMatches,
stableCipherSecretPresent, publicBaseOrigin.
Never put variable values, provider keys, auth tokens or room URLs in this receipt.

Exact backend paths checked:
GET /v1/q/rehearsals/video/interviewers — actor-admitted selector, maxSeconds 180.
GET /v1/q/rehearsals/<owned-id> — transcript count, review/provisional flags only.
GET /v1/q/rehearsals/<owned-id>/video — same private existing room and immutable deadline on repeat reads; no allocation.

Root-only TEST_MODE lifecycle after code/configuration preconditions:
Keep CQ_TAVUS_TEST_MODE=true and one admitted canonical profile. Using a fresh synthetic rehearsal reserved ONLY for test-mode validation, root may call POST /v1/q/rehearsals/<owned-id>/video with {"interviewerId":"partner-steve"}. Never run this on the future paid-pilot rehearsal: one video row per canonical rehearsal ever. Never create a room now for a founder joining later; its clock begins at allocation and expires in180s.
Browser URL must become /rehearsals/live/<owned-id>?video=1 before provider allocation. Refresh while allocation is pending or the private link is available; verify same canonical id, same video id, same original endsAt, at most one provider conversation. Authorized GET recovery is bounded to60s or endsAt; no repeated start or new Join appears.
Test-mode rooms have NO remote AI face joining and are NOT audiovisual acceptance. Browser private-room load, delegated microphone/camera permissions, disclosure and refresh are technical readiness only.
Verify early end through POST /v1/q/rehearsals/<owned-id>/video/end with {"continueByVoice":true}; provider confirmation before returning ACTIVE canonical voice continuation. Refresh must preserve that existing voice continuation. Use a distinct test-only canonical rehearsal for deadline completion because video rows never reopen.
Verify deadline through stored created_at/ends_at/status/ended_reason (redacted metadata), provider authoritative ended confirmation, and saved canonical transcript/review flags. Server timer and30s sweep complement provider max_call_duration<=180. API acknowledgement alone is not remote human video/audio proof.
POST /v1/q/rehearsals/<owned-id>/finish is now guarded: failed/unconfirmed video termination returns503 and must not generate a final review. Review GET never performs finish; active or physically open video redirects to existing live room.

When founder is actually ready (root only): record one paid allocation, switch only that admitted profile from test mode at that time, keep exactly one q-api replica/no deploy or restart during the180s cap, perform one human remote face/audio conversation with Q-backed lines and saved transcript, confirm provider end, inspect saved nonprovisional review, then restore test mode or remove new paid admission. The user has now authorized the single paid human pilot and is ready; wait the configuration deployment and old instance drain before allowing the one allocation.

Known broader rollout limitations: no durable spend ledger, allocation checkpoint or distributed bridge idempotency. Pending allocation compensation and turn coordination are process-local. No broad rollout claim.

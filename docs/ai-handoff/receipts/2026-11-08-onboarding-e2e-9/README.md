# Onboarding e2e run 9 on batch 13 (06be34c81, with D81 conversational depth), production, 1440

**Regressed:**

- Investor: J1 dense line fails. The run aborted after J4: GET /v1/onboarding/sessions/current returned 400.
- Founder: J1, J2 ×2 and J3 fail. It still finishes on /verification.

Root causes (q-api / api logs):

- D81 holds identity facts for the topic playback, so the organisation name isn't committed. Saves needing the organisation context are then refused: api 400 `onboarding_context_required`, "its name comes first", logged by q-api as "onboarding step failed; went on without it" at 11:54:46, 11:54:50 and 11:54:52.
- Clear typed answers are now held and played back, instead of saved in their words (D77).
- Read-backs come one value at a time, with bare "Is that right?" lines and a repeated question.

Assigned to W5. Integration-owner decisions under D82:

- identity facts save at once;
- clear typed answers save at once;
- playback once per topic, never one value per question, never bare.
- Stop-gap if needed: playbackBeforeSave=false.

---
title: UX1 — entry, voice-first Home, one welcome
project: capital-q
date: 2026-09-25
tags: [session-log, ux1, acceptance, home, onboarding, voice]
---

# UX1 — entry, voice-first Home, one welcome

**Objective:** acceptance items A (entry/proactivity), K (Q Home UI) and the restore half of B (duplicate "Welcome back"s). Branch `ux1/entry-home` from `recovery/2026-09-12` b9b2e78.

**What changed**
- `a973b9f` (lead-owned contract, for review): `CreateQVoiceSessionRequest.resume`; q-api voice route composes/records no opener and no fallback greeting on resume.
- `8c60585`: Home greeting inside `QConversationPanel` (welcome slot + `QSurfaceToolsContext`); `returning.ts`/`returning-facts.ts` setup facts (covered groups, pending Q line); workspace `pendingQuestion`, `greeted`, voice resume and talk-waits-for-opening; `use-voice-interview` reconnect/voice-switch resume + `withGreeting`.

**Decisions**
- Where they left off is Q's own last line, shown verbatim; Home never paraphrases interview wording (E3 owns it).
- Home stays theme-following (light first-class) rather than the always-dark `.cq-stage`.

**Open questions**
- Interviewer's voice opener still prefixes "Welcome back." whenever responses exist (E3 core); only reached now when no text opening exists.
- Local Deepgram credential is refused, so spoken audio was not heard in the browser runs.

**Next step**
- Lead review of the contract commit; ACC rerun of "reload mid-onboarding" and the two returning cases.

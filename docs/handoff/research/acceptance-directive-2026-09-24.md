# Product acceptance directive (user, 2026-09-24 evening) — binding

Fixture (mandatory adversarial input): `tonight-transcript.md` in this same folder — the user's real hosted session 19:26–19:52 UTC. Railway then ran code BEFORE E3 round 3 (8fde824/cf1de38) and before E5's last commits. So: FIRST reproduce each of your items on the CURRENT integration head (`recovery/2026-09-12`, ≥ 6c5fde8). If it no longer reproduces, report that with evidence and do not patch it. Do not patch stale deployed code blindly. NO deploys (lead only, and not until acceptance passes).

Rules: For every failure: reproduce → identify owning layer → fix the root cause → rerun the exact scenario. No phrase lists, no semantic regex patches (ADR 0011). Assert semantic outcome, authoritative state, actual tool effects and user-visible continuity — never exact prose. E3 owns conversation semantics; others coordinate with E3 through the lead, not by editing E3's conversation core.

A. ENTRY / PROACTIVITY — fresh and returning users land in the voice-first Q shell, not the legacy chat-centric Home. Incomplete onboarding: Q knows immediately, welcomes using known context, says naturally where they left off, offers relevant choices. Returning completed users: useful contextual greeting + quick actions. No duplicate welcome messages.
B. ONE RESPONSE OWNER — audit every subsystem that can append Q-visible messages. Session restoration, step engine, research, actions, presence emit structured events; one response composer owns final conversational output. Eliminate duplicate/stale messages (three "Welcome back"s; one voice utterance finalised as several "[continue]" user turns each answered separately → four answers to one question).
C. ACTIVE OBJECTIVE, NOT CURRENT FIELD — reason over the whole active objective and full authorised state. One turn may contain answers, corrections, questions, advice requests and action requests. The current onboarding step is background state, not a router that hijacks conversation.
D. REAL ACTION PLANNING / TOOL CHAINING — imperative requests have action priority. "Generate a PDF pitch deck for Zino Aviation from what you can find publicly." must autonomously become public research → evidence reconciliation → deck generation → PDF render → artifact persistence → downloadable result. Never explain that a deck could be generated; never make the user separately ask Q to gather what it is authorised and able to gather. Safe internal actions execute; consequential external actions keep approval.
E. FIT ≠ INTEREST — "Which investors are likely to invest?" means fit/prospect identification unless context says otherwise; don't replace it with a search for investors publicly associated with the company. Clearly separate inferred fit from evidenced interest.
F. SUGGESTION → AUTHORIZATION — Q may recommend preferences/exclusions without silently persisting them; explicit approval ("go with those", "use your picks") converts the recommendation into an authorised write.
G. WRITE FAILURE ROOT CAUSES — reproduce the exact "Adult content" / "Insurance" loops. Trace raw transcript → interpretation → taxonomy → intended field/domain → write → persisted state → eligibility. Fix the failing layer. Once an explicit high-confidence answer is persisted, never ask again merely to satisfy another representation of the same concept (I7.avoid vs I7.hard_exclusions vs I7.sector_exclusions).
H. RESPONSE POLICY — action request → minimal acknowledgement, execute, result. Analysis request → evidence-backed explanation. Conversational question → natural answer. Onboarding → answer the person first, quietly update state, resume only when useful. Learn explicit session-level communication preferences ("just give me the result", "you're talking too much").
I. INVESTIGATION STATE — stale "I'm comparing the opportunities now" during unrelated work. Investigation/progress events are run-scoped and clear on completion/cancel/interruption.
J. VOICE PROACTIVITY + BARGE-IN — after explicit voice activation Q speaks first then listens. Speech onset interrupts playback immediately. Cancel obsolete speech/generation on interrupt. Never leave the user talking over old audio.
K. UI — Q Home is the living swarm/voice experience. Chat history secondary/collapsible. Typing, research, artifact generation, artifact preview/download and conversation all happen within the same Q experience; no switching to a ChatGPT-style page for Q work.

ACC adversarial cases (exact):

- "What do you know about me so far?" → natural synthesis, not a field count.
- "Pick three exclusions you think fit me and go with those." → Q reasons, recommends and records because explicit authorization was given.
- "Adult content." → persists once, no repeat loop.
- "Just give me the PDF." → real artifact, no explanation dump.
- "Which specific investors would likely invest?" → fit candidates, not only existing-interest evidence.
- interrupt Q mid-sentence → Q stops immediately and listens.
- reload mid-onboarding → one coherent resume greeting and correct context.
- incomplete returning user → proactive resume choices.
- completed returning user → contextual welcome + useful quick actions.

Also observed in the fixture: Home Q told an onboarded investor "I cannot determine who you are from the authorised profile" (no profile context reached Home Q); "What do you have on me so far?" answered as "19 of 33 answered, 14 to go…" field dump.

Ownership (lead-assigned):

- E3: B (interview/response composer side), C, F, G, H (onboarding + "what do you know about me" synthesis + session communication prefs in the interview).
- E4: D (Home Q action planning/tool chaining, deck → PDF artifact), H for Home Q action requests ("just give me the PDF").
- E5: E (fit ≠ interest), Home Q knowing the person's own authorised profile ("who am I"), I (run-scoped investigation/progress state).
- VN1: J (voice proactivity + barge-in) and the voice half of B (one utterance → one turn; no "[continue]" fragments each answered).
- UX1: A (entry/proactive resume + returning greeting, no duplicate welcomes) and K (voice-first Q home, collapsible history, artifacts in the Q experience).
- ACC: encode the 9 adversarial cases + fixture scenarios as a repeatable acceptance suite; triage reproduction on the head; rerun after fixes.

Local env (all): services override DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres DATABASE_CONNECTION_MODE=direct CAPITAL_Q_ENV=local SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=<LOCAL_SUPABASE_PUBLISHABLE_KEY> SUPABASE_SECRET_KEY=<LOCAL_SUPABASE_SECRET_KEY>. Run q-api/api WITHOUT --watch (package builds cause restart storms that look like model failures); start q-api after your build. One workers process only (ACC's, worktree agent-a13265cf2e410d7dd) — don't start another. Never supabase db reset / DB-wide cleanup; never touch hosted DB/Railway. Contracts/migrations are lead-owned: mark such commits "(lead-owned …, for review)". eslint needs NODE_OPTIONS=--max-old-space-size=8192. Write regex-containing files with Write/Edit, not heredocs. Never bare git stash. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push or merge; report SHAs.

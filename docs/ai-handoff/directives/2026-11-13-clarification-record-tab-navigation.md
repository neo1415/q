# Clarification: contextual navigation to a record's tab or section (owner, 13 Nov 2026)

Owner's words, condensed and kept faithful:

1. Q may navigate contextually to the correct **tab or section of a specific company, relationship or other authorised record**, not only to general screens such as Pipeline or Daily.
2. **First complete the v87 fix** (`550ecdd5c`, reader `navigation.tab`).
3. Then **reconcile the existing navigation paths**, so Q consistently resolves the intended record and its relevant tab both when the user explicitly asks to go somewhere and when Q identifies a genuinely useful contextual move.
4. **Reuse** the existing turn reader, record resolver, navigation decider, screen contracts and permission safeguards. **No** new navigation engine, no keyword-driven routing, no unnecessary model calls.
5. **Preserve:**
   - pinned-workspace protection;
   - unsaved work;
   - stable follow-ups;
   - the ability to answer without navigating.
6. **Test real conversational examples:**
   - indirect references;
   - cross-turn follow-ups;
   - ambiguous records;
   - inaccessible tabs.

   Not complete on isolated unit tests alone; live verification is required.

7. This is a **bounded completion**, not another prolonged navigation programme.
8. After certification, keep the parallel execution arrangement and advance the major unfinished workstreams:
   - A8 grounded claim extraction and research intelligence;
   - C2/C3 capability execution;
   - GateQ interviews and full applicant journeys;
   - founder-investor end-to-end flows.

   Do not keep polishing navigation that already works. Maintain the complete acceptance matrix and continue autonomously.

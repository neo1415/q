# Directive: intelligence limits, GateQ reliability and execution blockers (owner, 14 Nov 2026)

Continues the consolidated directive, the acceptance matrix, parallel execution and the release process. This is a targeted correction, not a new planning programme.

1. **Small paid tests are pre-authorised.** Do not ask the owner again for routine engineering tests.
   - Limits: up to $5 estimated per test or evaluation, and up to $20 per UTC day in aggregate.
   - Use synthetic data and already-authorised environments.
   - Record the provider, usage, cost and outcome of each test.
   - Ask only when a limit would be exceeded, a new paid commitment is needed, or privileged access is genuinely missing.
   - Never bypass credential isolation, expose keys, weaken authorisation or claim a test passed that did not run.
   - A missing optional evaluation key never blocks unrelated work.
2. **Audit arbitrary limits that reduce Q's intelligence.**
   - The 9-point GateQ synthesis cap is not acceptable as a total limit. It used to reject the whole reading, and the newer workaround silently drops points.
   - Fix at every level: contract, generation, validation, persistence and presentation.
   - Distinguish three things: a compact summary; complete, evidence-backed analysis reached by expansion, follow-up or pagination; and justified technical limits.
   - Never silently truncate, discard or overwrite valid findings.
   - Audit:
     - synthesis findings;
     - transcript context truncation;
     - 2,000-character accumulated facts;
     - the four-unresolved-contradictions cap;
     - recent-turn memory;
     - hard-coded question limits;
     - document excerpt budgets;
     - maximum model output and structured result sizes.
   - Keep the security, abuse, resource and cost controls. Replace arbitrary semantic ceilings with batching, structured persistence, retrieval, continuation, or explicit reporting of incompleteness.
   - Use versioned contracts and migrations; do not break existing readers. Do not just raise character limits.
3. **Fix GateQ at the invariant level.**
   - The defect family:
     - statements replacing unrelated facts;
     - corrections erasing history;
     - false contradictions;
     - repeated questions;
     - zero becoming unknown;
     - false claims that something was recorded;
     - interviews wedged by a failed reply;
     - synthesis dropped on a schema limit;
     - mixed sources.
   - First finish the D11 gate and its live re-check.
   - Then run a realistic, long, multi-turn regression journey: evolving facts, corrections, contradictions, unknowns, zeros, topic changes, follow-ups, a resumed session and submission. Verify:
     1. every meaningful founder statement is recoverable, with provenance and history;
     2. a correction affects only the intended statement or metric;
     3. contradictions stay visible until explicitly resolved;
     4. Q does not re-ask settled information;
     5. an unresolved question is not treated as an unanswered one;
     6. a failed model response cannot permanently wedge an interview;
     7. Q never claims success without a matching authoritative execution result;
     8. the founder review, submitted dossier, investor inbox and Q's analysis agree on the facts and their sources.
   - Prefer durable, atomic statement identities and append-oriented history over concatenated-text replacement. No keyword or prompt patches where the problem lies in state, contracts or persistence.
   - Certify a sustained conversation end to end, not isolated examples.
4. **Continue the other streams in parallel.** Do not let GateQ take every cycle.
   - A8 research to claims, and richer intelligence.
   - Document and financial evidence.
   - C2/C3 capability awareness and executable actions.
   - GateQ voice-only and Tavus interviews. Voice-only is implemented now as bounded vertical slices; the earlier estimate is not a reason to defer it.
   - GateQ branding, publishing and investor self-service.
   - Founder–investor meetings, diligence and cross-feature journeys.
   - Q voice performance and live certification.

   Pausing heavy tests during a gate is fine. Deferring a stream indefinitely is not.

5. **Evidence and priority.**
   - Keep the stages distinct: implemented, locally tested, deployed, live verified.
   - For each defect family, record:
     - the root cause;
     - the invariant that prevents recurrence;
     - the tests that would fail without the fix;
     - the live scenario that shows it working.
   - Correct matrix rows whose notes contradict their headline status.
   - Foundations and complete journeys come before cosmetic patches.
   - Locked architecture, the Context Firewall, human approval, provenance, RLS, tenant isolation and the release gate are all preserved.

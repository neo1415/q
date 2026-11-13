# Addendum (owner, 13 Nov 2026): semantic intelligence must not degenerate into keyword routing

Continues the consolidated directive and the completeness addendum.

1. Audit natural-language routing across Q for keyword-driven interpretation: entity identification, chart intent, metric selection, navigation, feature suggestions, research intent and action execution.
2. Regexes, enum maps and fixed calculations are acceptable for well-defined structured data. They are never the primary interpreter of arbitrary user intent.
3. Reuse the existing model-driven turn reader and orchestration contracts. Extend its structured output (resolved intent, entity references, canonical metric identifiers, time ranges, capability selection).
4. Resolve companies through conversational context, authorised entity search, canonical identities and explicit disambiguation, never through capitalisation or a growing stop-word list.
5. Resolve metrics semantically to canonical metric definitions. No revenue-first fallback that shows revenue when retention or users were asked for.
6. Execution stays deterministic in code: permission filtering, metric validation, calculations, currency compatibility, provenance, chart construction and rendering. The model never invents points or bypasses authorisation.
7. No extra LLM call per request. Use the existing reading pass; ask for clarification only where ambiguity matters. Keep latency and cost budgets.
8. No second agent, orchestration system or parallel intent registry.
9. Tests:
   - semantic equivalence: paraphrases, implied visualisation, follow-ups ("Now do the same for Clinicrest");
   - names containing ordinary words, ambiguous companies;
   - revenue, MRR, ARR, retention, users and growth;
   - voice and multilingual phrasing;
   - negatives;
   - missing, conflicting, private or incomparable data.
10. Acceptance:
    - unseen phrasings map to the same typed intent and authorised execution;
    - every keyword rule that remains is documented as structured-data validation or a bounded fallback;
    - the principle is applied across Q;
    - not complete until paraphrase, context and follow-up tests pass.

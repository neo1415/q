# Q on Claude: paid parity run 1 (6 Nov 2026, ~20:05 UTC)

Branch `fix/q-claude-parity` @ 7aa4bf665. Command: `--live --provider anthropic --q-only --limit 12 --budget 4` (12 cases, round-robin).

- **Cost: $1.556** ($0.130 per case; before: $0.30–0.49).
- **Anthropic test spend running total: about $6.0.** This counts today's bare-Claude benchmarks ($2.10 + $0.21 + $2.13) plus this run. The lane's earlier adapter tests are not included (its receipt has them). The budget is $50; slow down from $20 (DECISIONS 68).
- **Cache reads (share of input tokens):**
  - Sonnet answer calls: about 80% (1.40M of 1.74M);
  - Haiku turn reader: about 87%;
  - Sonnet TEXT calls: about 51%.

  Cache writes (about 450k tokens) are now the largest cost line.

- **Quality: 71.1% of turns; 5/12 cases.**
  - By category: PRONOUNS 75, ORDINALS 20, FOLLOW_UPS 60, CORRECTIONS 75, COMPOUND 100, UNKNOWN 75, CONTRADICTIONS 100, NUMBERS 100, MEMORY 100, AMBIGUITY 66.7, ADVERSARIAL 100, DISCOVERY 0 (harness).
  - Wrong-entity turns: 7.
  - The failures are mostly reference binding (ordinals and pronouns resolved to the wrong company), with the turn reader on claude-haiku-5-5.
- Files: `claude-calls.log` (per-call debug lines), `failures.json`.

## Run 2: Sonnet throughout plus the answer-scope line (fix/q-claude-parity @ 728606250)

- **Cost: $1.737** ($0.145 per case). The reader now runs on Sonnet: quality before price (DECISIONS 69).
- **Anthropic test spend running total: about $7.7.** That is today's benchmarks ($4.44), run 1 ($1.556) and this run. The lane's earlier adapter tests are in its own receipt.
- **Quality, excluding DISCOVERY** (the harness has no web): **39/42 turns, 92.9%** (run 1: 32/42, 76.2%). Over the same 11 cases in Live run 2: Q on OpenAI 39/42, bare OpenAI 40/42. **Quality parity with Q on OpenAI.**
  - PRONOUNS, FOLLOW_UPS, CORRECTIONS, COMPOUND, UNKNOWN, CONTRADICTIONS, MEMORY and ADVERSARIAL: 100%.
  - ORDINALS 80%, NUMBERS 80%, AMBIGUITY 66.7%.
- Wrong-entity turns 7 → 1; invented-figure turns 3 → 1. The remaining failures:
  - ORD-016 t3: wrong entity.
  - NUM-106 t3: unrequested working; the claim-check arithmetic slice owns it.
  - AMB-136 t1: a figure missing.
- Debug lines: `claude-calls-run2.log`.

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

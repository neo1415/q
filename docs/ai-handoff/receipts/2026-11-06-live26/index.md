# live26 — reader thinking OFF on production (2dba5ed8c, 6 Nov 2026, ~19:58 UTC)

Fictional investor; one conversation, four typed turns (normal product use, a few cents on the production OpenAI account). No "account exhausted" log lines in this deployment: OpenAI was serving again.

| Turn                | Binding                                      | Whole reply (ms)   | Reader `readMs` |
| ------------------- | -------------------------------------------- | ------------------ | --------------- |
| What does Duplo do? | Duplo ✓                                      | 6172               | —               |
| What about Bumpa?   | Bumpa ✓ (same question, new company)         | 14537 (web search) | 1444            |
| And their stage?    | Bumpa ✓ ("recorded as seed stage")           | 6401               | 1730            |
| Who founded it?     | Bumpa ✓ (Kelvin Umechukwu, Adetunji Opayele) | 7928               | 1492            |

The reader now takes **1.4–1.7 s** (it was 4–5 s at LOW). `beforeAnswerMs` was about 1.7 s. Binding held on all four turns. Rollback, if needed, without a deploy: set the active FAST_CLASSIFICATION policies' `reasoning_levels` to `{"TURN_READ":"LOW"}`.

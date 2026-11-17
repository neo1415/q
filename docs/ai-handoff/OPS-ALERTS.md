# Operational alerts, spending caps and usage limits (launch readiness 7–9)

## Alert lines (all structured JSON, level `error`)

| `alert` field        | Service | Means                                                                                                                                                                                                                    |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPS_CHECK`          | workers | The minute check found something. `findings` lists codes: `Q_RUN_STUCK`, `Q_RUN_FAILURE_RATE`, `DB_TIMEOUTS`, `MODEL_PROVIDER_FAILURE_RATE`, `MODEL_SPEND_NEAR_CAP`, or `CHECK_FAILED` (the database could not be read). |
| `DB_TIMEOUTS`        | q-api   | At least 3 statements in q-api ended in 57014 in the last minute (`dbTimeouts` = count).                                                                                                                                 |
| `RESEARCH_DAILY_CAP` | q-api   | A paid research credential hit its daily call cap; research degrades until 00:00 UTC.                                                                                                                                    |
| `SPEECH_DAILY_CAP`   | q-api   | The service's daily text-to-speech cap is met; answers still show on screen.                                                                                                                                             |

Each `OPS_CHECK` finding is also sent through the existing operator channel (`qAlert: "OPERATOR"` line plus an email to every platform admin when Brevo or SMTP is configured), at most once per finding per six hours.

## Wiring Railway

- Railway's log explorer filters structured attributes: search `@alert:OPS_CHECK` on workers, `@alert:DB_TIMEOUTS` on q-api, or plain `alert:` to see all of them.
- If your Railway plan offers log-based alerts or webhooks on a log filter, point them at those filters. If it doesn't, the operator email above is the push channel, and the filters are where to look.

## Settings (all optional; out-of-range values keep the default and are logged)

| Variable                                                        | Service             | Default          |
| --------------------------------------------------------------- | ------------------- | ---------------- |
| `CQ_OPS_CHECK` (`off` disables)                                 | workers             | on               |
| `CQ_OPS_CHECK_INTERVAL_MS`                                      | workers             | 60000            |
| `CQ_OPS_STUCK_RUN_MS`                                           | workers             | 120000           |
| `CQ_OPS_WINDOW_MS` (failure-rate window)                        | workers             | 900000           |
| `CQ_OPS_FAILED_RUN_RATE` / `CQ_OPS_FAILED_RUN_MIN_RUNS`         | workers             | 0.25 / 8         |
| `CQ_OPS_PROVIDER_FAILURE_RATE` / `CQ_OPS_PROVIDER_MIN_ATTEMPTS` | workers             | 0.5 / 20         |
| `CQ_OPS_DB_TIMEOUTS_PER_CHECK`                                  | workers             | 3                |
| `CQ_OPS_SPEND_ALERT_FRACTION`                                   | workers             | 0.8 of the cap   |
| `CQ_MODEL_DAILY_SPEND_CAP_USD` (`off` = no cap)                 | api, q-api, workers | 50 (was: no cap) |
| `CQ_RESEARCH_DAILY_CALLS` (per paid credential)                 | q-api               | 2000             |
| `CQ_SPEECH_DAILY_LINES` (whole service)                         | q-api               | 3000             |
| `CQ_Q_RUNS_PER_MINUTE` / `CQ_Q_RUNS_PER_DAY` (per person)       | q-api               | 20 / 300         |
| `CQ_VOICE_STARTS_PER_10MIN` (per person)                        | q-api               | 20               |

Set `CQ_MODEL_DAILY_SPEND_CAP_USD` to the same value on every service, so the workers' alert measures against the cap the gateways enforce.

Limits refused at the API are RFC 9457 problems with `code: "RATE_LIMITED"` (429), a plain-English `detail`, and `Retry-After` for Q runs. The web shows that `detail`.

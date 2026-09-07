# Q Resumable SSE Streaming (`GET /v1/q/runs/:runId/events`, CQ-Q-009)

**Purpose.** The server-to-browser channel through which a person watches
a Q run: high-level stages, live text, the persisted answer, findings,
prepared actions and approval requests, clarification requests, and the
run's end. Server-Sent Events over the existing bearer-authenticated HTTP
API (AEC-018). Durable run events are the truth and are replayed by their
per-run sequence (AEC-019, AEC-020); the transport adds nothing to them
and never carries hidden reasoning (AEC-021).

```
SSE            = transport                (never source of truth)
durable event  = q_runtime.run_events row (id: = sequence, replayable)
delta          = live presentation        (no id, never stored, never replayed)
heartbeat      = SSE comment              (never an event, never a row)
disconnect     ≠ cancellation             (a closed tab changes nothing about the run)
transport state ≠ run status              (CONNECTING/RECONNECTING is the client's own)
```

Sources: doc 12 §37; doc 22 §69-76 (SSE, format, event types, ids,
durable store, heartbeat, delta persistence); doc 21 §80, §219 (graceful
shutdown, graceful Q deploy); doc 15/16 (no chain of thought, tenancy);
doc 24 (Q concurrency baseline); CQ-Q-001/002 (contract and store).

## Why SSE

The dominant direction is server → browser. Commands stay HTTP POST
(`/runs`, `/messages`, `/cancel`, `/approvals/:id/approve|reject`), so the
stream is one-way, reconnect semantics exist in the protocol, and no
WebSocket, Redis or hosted realtime service is needed for V1 text Q.

## Endpoint

| Item           | Value                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Route          | `GET /v1/q/runs/:runId/events`                                                                             |
| Auth           | `Authorization: Bearer <access token>` (the same session as every Q route); optional `x-organisation-id`   |
| Resume         | `Last-Event-ID: <durable sequence>` header; `0` or absent = from the beginning                             |
| Response       | `200 text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`   |
| First bytes    | `retry: 3000` hint                                                                                         |
| Frame          | `event: <QStreamEvent type>` · `id: <sequence>` (durable only) · `data: <QStreamEvent JSON>` · blank line  |
| Heartbeat      | `: heartbeat` every 15 s                                                                                   |
| Close          | after the terminal event (`q.run.completed`, `q.run.failed`), after a terminal run's replay, or on error   |
| Before headers | 401 / 404 / 422 / 429 RFC 9457 problem documents                                                           |
| After headers  | `: stream-error` or `: server-shutdown` comment, then a clean close; the client reconnects with its cursor |

Authorization is the run owner's, resolved on the server (`ownedRun`):
a colleague in the same tenant, the same person in another context and a
foreign tenant all receive the identical 404 and a `permission_denied`
security event. A run id, a tenant id or a user id in the URL is input,
never authority; a token in the URL is prohibited and the client never
sends one.

## Event mapping

The SSE `event:` name is the QStreamEvent `type`, unchanged. No second
vocabulary exists.

| Type                  | Class     | `id:`    | Data                                                    |
| --------------------- | --------- | -------- | ------------------------------------------------------- |
| `q.run.started`       | durable   | sequence | capability, status, conversationId                      |
| `q.stage.changed`     | durable   | sequence | `QVisibleStage`                                         |
| `q.message.delta`     | ephemeral | none     | messageId, text (≤ 4000 chars per frame)                |
| `q.message.completed` | durable   | sequence | the persisted Q message                                 |
| `q.finding.available` | durable   | sequence | public finding (no producer yet)                        |
| `q.action.proposed`   | durable   | sequence | public proposal (summary, preview, targets)             |
| `q.approval.required` | durable   | sequence | proposalId, approvalId, expiresAt                       |
| `q.input.required`    | durable   | sequence | clarification request (no producer yet)                 |
| `q.run.completed`     | durable   | sequence | terminal                                                |
| `q.run.failed`        | durable   | sequence | terminal; FAILED / CANCELLED / EXPIRED + public failure |

A delta's `sequence` field names the durable boundary it follows; it is
not unique and never an SSE id. `Q_STREAM_DURABLE_EVENT_TYPES` and
`Q_STREAM_EPHEMERAL_EVENT_TYPES` partition the union in the contracts.

## Durable versus ephemeral

Durable events are written by the runtime in the same transaction as the
state they describe (run started, stage, message completed, action
proposed, approval required, completed, failed, cancelled). They carry the
per-run sequence allocated under the run's row lock (CQ-Q-002). Nothing
is written per token: the answer seam publishes deltas to an in-process
bus and persists one message with one `q.message.completed` event.

**Final-message authority.** The client accumulates deltas into a partial
buffer keyed by message id; when `q.message.completed` arrives the
persisted text replaces the buffer whatever was missed. A reconnect never
replays deltas; it replays the completed message.

## Replay and the replay/live race

```
subscribe to the run's notifier            (before any read)
read events where sequence > cursor        (pages of 200, cap 10 000)
emit each; cursor = its sequence; terminal → end
on every notice: read again after cursor   (a notice during the read only sets a flag)
no notice for 15 s: read again anyway; if the run is terminal → end
```

Every read is "after my cursor", so one connection never sends the same
durable event twice, and an event committed while the reader switches
from replay to live is announced by a notice the reader already holds.
The wake-up is Postgres NOTIFY (`q_run_events`, payload `{ runId,
sequence }`) issued by the run-event repository inside the append's
transaction, delivered on commit, LISTENed on one dedicated connection
per q-api instance — so a run executed by one instance is observed live
from another, with no in-memory hand-off. Notices are never events.

A `Last-Event-ID` ahead of the run's last sequence is clamped to it. A
run already terminal replays what follows the cursor and closes.

## Duplicates

Delivery is at-least-once across reconnects (a client may resend a cursor
older than what it processed). The client drops any durable event whose
sequence is ≤ its cursor and upserts messages, findings and proposals by
id, so a replayed event never duplicates UI. Exactly-once on the wire is
not promised and not needed.

## Heartbeat, backpressure, disconnect

- Heartbeat: `: heartbeat` every 15 s (the safety re-read runs on the
  same cadence). No row, no sequence, no event.
- Backpressure: `write()` returning false is awaited on `drain`; a client
  that does not drain within 30 s is disconnected. Deltas are dropped
  while the socket is congested (the persisted message follows); durable
  frames wait. The reader's delta queue is bounded (256) and the stream
  frame is bounded (64 KiB).
- Disconnect: the socket closing aborts the reader, removes the notifier
  and delta subscriptions, clears the heartbeat and destroys the socket
  once the last frame is flushed. The run is untouched.
- Limits: at most 8 streams per person and 4 per person and run in one
  process (429 `RATE_LIMITED`). Process-local hygiene, never authorization.
- Shutdown: a `preClose` hook ends every stream with `: server-shutdown`;
  the app closes idle connections and force-closes active ones after a
  bounded grace (5 s). Clients reconnect to the replacement instance and
  replay from their cursor (doc 21 §80, §219).

## Client (`@capital-q/api-client`)

`streamQRunEvents(session, runId, { onEvent, onStatus, lastEventId,
signal, backoff })` is a fetch-based SSE reader: normal Authorization
header, a conforming incremental parser (`createSseParser`), bounded
exponential backoff with full jitter (500 ms → 15 s, 20 attempts, or the
server's `retry:` hint), `Last-Event-ID` from the last durable sequence,
duplicate suppression, a stop on 401/403/404/422, and a transport status
(`CONNECTING`, `CONNECTED`, `RECONNECTING`, `CLOSED`) that is never the
run's status. `reduceQStream` is a deterministic reducer to presentation
state; `describeQStage` and `describeQStreamTransport` give plain English.
Refreshing the page rebuilds everything from the server.

## Observability

Metrics (labels: route, event_type, reason, stage, mode — never an id):
`q_sse_connections_active`, `q_sse_connections_total`,
`q_sse_reconnects_total`, `q_sse_replay_events_total`,
`q_sse_live_events_total`, `q_sse_auth_denied_total`, `q_sse_errors_total`,
`q_sse_backpressure_events`, `q_sse_deltas_dropped_total`,
`q_sse_heartbeats_total`, `q_sse_connection_duration_ms`,
`q_sse_time_to_first_event_ms`. Span `q.stream.authorize`. Logs carry
request id, run id, reason, counts and timings; never a frame's content.

## Deployment assumptions

q-api runs on Render (ADR-0001). SSE needs no proxy feature beyond
pass-through of a chunked `text/event-stream` response, which
`X-Accel-Buffering: no` and `no-transform` request. The 15 s heartbeat
keeps the connection inside common proxy idle windows. A deploy ends
streams gracefully; the guarantee is the durable run plus a reconnecting
client, not one TCP connection. This has been verified locally only;
production behaviour behind Render's proxy is an assumption to confirm in
the infrastructure packet.

## Model streaming

No configured provider streams (`streaming: false` on Google, Groq and the
fake), and the answer is a structured call whose partial JSON must not be
shown (§35). Production therefore emits stages and the persisted message,
honestly, with no fake deltas. The delta bus (`QLiveDeltaBus`) and the
optional client-generated message id on `NewQConversationMessage` are the
seam a streaming-capable answer path plugs into; the synthetic streaming
answer in `apps/q-api/src/dev` exercises that path end to end in tests and
in the developer smoke.

## Multi-instance seam

`QRunEventNotifier` is the abstraction: `createPostgresQRunEventNotifier`
(LISTEN/NOTIFY) in production, `createInProcessQRunEventNotifier` in
tests. Replacing it with Redis pub/sub or a managed transport changes no
contract and no route. Deltas are in-process today; cross-instance deltas
would use the same channel pattern.

## Voice and the later UI

Voice reuses the same run, message, action and approval identities; audio
travels over WebRTC later while this stream keeps carrying stages,
results, approvals and run state. The semantic events here are what a
responsive Q presence renders — the visual design system owns how.

## Developer smoke

```bash
pnpm build --filter=@capital-q/q-api...
pnpm q:stream-smoke -- --synthetic --verbose
```

Shows: `[Q] Request received`, the stages in plain English, live text
arriving, a deliberate disconnect after a few durable events, a reconnect
with `Last-Event-ID`, the replayed persisted message, `[Q] Complete`, and
a check that the recovered answer matches the persisted run. Without
`--synthetic` and with a provider key in `.env.local`, the run goes
through the real gateway (stages and the persisted message; no deltas).
`--approval` runs the approval flow with the test action.

## Explicit deferrals

Provider streaming and a text-first answer design (CQ-Q-0xx with the
gateway); producers for `q.finding.available` and `q.input.required`
(later Q specialists); an approvals list surface; cross-instance deltas;
Render proxy verification (infrastructure packet); the Q eval harness
(CQ-Q-010); the web Q workspace (web slices).

## Tests

- contracts `q-stream.test` (12): partition, classification, Last-Event-ID.
- api-client `sse-parser.test` (9), `q-stream-reducer.test` (8), `q-stream-client.test` (7).
- q-runtime `stream.test` (8): replay, race, deltas, cap, projector, safety poll, cleanup.
- q-api `q-events.test` (18, real socket): auth, 422s, framing, replay, live, heartbeat, terminal, limits, multi-subscriber, backpressure, shutdown, error-after-headers, projector.
- q-api `q-events.integration.test` (9, real Postgres): reconnect demo, process recreation and cross-instance NOTIFY, replay/live race under concurrent writes, multiple connections, authorization, cancellation, approval flow, privacy markers, concurrency baseline.

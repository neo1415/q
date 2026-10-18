# Anonymous GateQ applicant surface

Why included: Only anonymous model-reaching write path; in-process per-session throttle.

## `apps/api/src/http/gateq-apply.ts` lines 31-58

```ts
31; /**
   32   * `/v1/gateq/apply` — the public applicant surface (CQ-GATE-002R §2–§5).
   33   *
   34   * Every route here is anonymous. There is no `onRequest` context hook
   35   * anywhere below, deliberately and visibly: a GateQ applicant has no
   36   * Capital Q account, and the whole point of the packet is that they never
   37   * need one. Authority is a bearer credential that names exactly one
   38   * application at exactly one gateway and carries no capability at all.
   39   *
   40   * Three things the routes do rather than trust.
   41   *
   42   * **Nothing about identity comes from the body.** There is no tenant, no
   43   * investor organisation, no gateway version, no company id and no
   44   * qualification outcome in any request schema. The server derives all of
   45   * them from the credential and the frozen policy, because a field a
   46   * browser fills is a field a browser can forge.
   47   *
   48   * **Every refusal is the same refusal.** A forged credential, an expired
   49   * one, a revoked one and a valid one naming somebody else's application
   50   * are one 404. So are an unknown gateway, an unpublished one and a
   51   * malformed id. An endpoint that distinguishes them is an endpoint that
   52   * answers questions nobody asked.
   53   *
   54   * **What comes back is the deterministic answer.** The reply is the
   55   * model's; the applicant's standing is GATE-001's, recomputed after the
   56   * turn's facts were recorded. A model sentence saying "looks like you
   57   * qualify" changes nothing in the payload beside it.
   58   */
```

## `apps/api/src/http/gateq-apply.ts` lines 175-200

```ts
  175    app.post(GATEQ_APPLY_START_PATH, async (request, reply) => {
  176      const input = parseContract(
  177        StartApplicationRequestSchema,
  178        request.body,
  179        "No such gateway.",
  180      );
  181      try {
  182        // Before any row or model call. Keyed on the gateway, because a
  183        // stranger has no session yet; the web tier adds a per-visitor limit.
  184        if (
  185          throttle !== undefined &&
  186          !throttle.charge({
  187            sessionId: `start:${input.gatewayPublicId}`,
  188            operation: "START",
  189          })
  190        ) {
  191          throw new IntakeRefusedError("TOO_MANY_REQUESTS");
  192        }
  193        const started = await intake.start({
  194          gatewayPublicId: input.gatewayPublicId,
  195        });
  196        // F1: the form needs no opening line, so it reaches no model.
  197        const opening =
  198          input.mode === "form"
  199            ? ""
  200            : await conversation.openingFor({
```

## `packages/gateq-intake/src/domain/throttle.ts` lines 1-34

```ts
1; /**
    2   * How much one guest session may do (CQ-GATE-002S §8).
    3   *
    4   * The applicant surface is the only anonymous write path in the product,
    5   * and a conversational one: every turn spends somebody else's model
    6   * budget. Bounding the shape of a request is not the same as bounding how
    7   * often it arrives, and GATE-002R only did the first.
    8   *
    9   * Three things make this safe to key on.
   10   *
   11   * **The key is earned, never given.** It is the server-issued id of a
   12   * session that has already been verified, so a caller cannot choose their
   13   * own bucket, and nothing replayable as a session ever reaches a counter,
   14   * a log line or a metric label. A forged credential fails verification
   15   * before it gets here, which means it buys no quota and leaves no bucket
   16   * to probe — charging first and verifying afterwards would have given an
   17   * attacker both.
   18   *
   19   * **One guest's quota is one guest's.** Buckets are per session and per
   20   * operation. A founder hammering submit exhausts their own allowance and
   21   * nobody else's; there is deliberately no global counter that a single
   22   * applicant could trip for everybody.
   23   *
   24   * **It forgets.** An unbounded Map with a public entry point is a memory
   25   * leak, so expired buckets are swept on write and the table is capped. Under the cap the oldest window goes first, which costs
   26   * an attacker their own oldest counter rather than anybody else's current
   27   * one.
   28   *
   29   * In process, on purpose: no Redis, no new service, no new credential.
   30   * Each API instance holds its own counters, which is a weaker bound than a
   31   * shared one and a much stronger bound than none. A distributed limiter is
   32   * a real thing to want and it is not this packet.
   33   */
34;
```

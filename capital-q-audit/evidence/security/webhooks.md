# Webhook authentication

Why included: Recall Svix HMAC with timestamp tolerance (no id dedupe); inbound email basic auth; meeting token in query.

## `apps/q-api/src/composition/recall-bots.ts` lines 460-515

```ts
  460  export function verifySvixSignature(input: {
  461    readonly secret: string;
  462    readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  463    readonly rawBody: Buffer;
  464    readonly now: Date;
  465  }): boolean {
  466    const id = header(input.headers, "svix-id", "webhook-id");
  467    const timestamp = header(
  468      input.headers,
  469      "svix-timestamp",
  470      "webhook-timestamp",
  471    );
  472    const signatures = header(
  473      input.headers,
  474      "svix-signature",
  475      "webhook-signature",
  476    );
  477    if (id === null || timestamp === null || signatures === null) return false;
  478    if (!/^\d{1,12}$/.test(timestamp)) return false;
  479    const sentAt = Number(timestamp) * 1_000;
  480    if (Math.abs(input.now.getTime() - sentAt) > WEBHOOK_TOLERANCE_MS) {
  481      return false;
  482    }
  483    const key = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  484    if (key.length === 0) return false;
  485    const expected = createHmac("sha256", key)
  486      .update(`${id}.${timestamp}.`)
  487      .update(input.rawBody)
  488      .digest();
  489    return signatures.split(" ").some((entry) => {
  490      const [version, value] = entry.split(",", 2);
  491      if (version !== "v1" || value === undefined) return false;
  492      const given = Buffer.from(value, "base64");
  493      return given.length === expected.length && timingSafeEqual(given, expected);
  494    });
  495  }
  496
  497  export function createRecallStatusWebhook(options: {
  498    readonly secret: string | undefined;
  499    readonly settleBot: (botId: string) => Promise<unknown>;
  500    readonly now?: () => Date;
  501  }): RecallStatusWebhook | undefined {
  502    const secret = options.secret;
  503    if (
  504      secret === undefined ||
  505      !secret.startsWith("whsec_") ||
  506      secret.length < 20
  507    ) {
  508      return undefined;
  509    }
  510    const now = options.now ?? (() => new Date());
  511    return {
  512      verify: (headers, rawBody) =>
  513        verifySvixSignature({ secret, headers, rawBody, now: now() }),
  514      receive: async (body) => {
  515        const botId = recallEventBotId(body);
```

## `apps/q-api/src/http/meeting-host.ts` lines 20-80

```ts
   20  const QuerySchema = z
   21    .object({
   22      meeting: z.string().uuid(),
   23      token: z.string().min(20).max(200),
   24    })
   25    .passthrough();
   26
   27  export function registerMeetingHostRoutes(
   28    app: FastifyInstance,
   29    dependencies: {
   30      readonly host?: MeetingHostRuntime | undefined;
   31      /**
   32       * meet-47: Recall's account-level status webhook (bot ended, transcript
   33       * ready) is delivered to the same path, Svix-signed and without a
   34       * meeting token, so a late transcript is settled the moment it exists.
   35       */
   36      readonly status?: RecallStatusWebhook | undefined;
   37    },
   38  ): void {
   39    const { host, status } = dependencies;
   40    // The raw bytes are kept: Recall's status signature covers them exactly.
   41    void app.register((scope, _options, done) => {
   42      scope.addContentTypeParser(
   43        "application/json",
   44        { parseAs: "buffer", bodyLimit: 256_000 },
   45        (_request, body, parsed) => {
   46          parsed(null, body);
   47        },
   48      );
   49      scope.post(
   50        MEETING_HOST_WEBHOOK_PATH,
   51        {
   52          bodyLimit: 256_000,
   53          // The call's words never go to request logs.
   54          logLevel: "warn",
   55        },
   56        async (request, reply) => {
   57          const raw = Buffer.isBuffer(request.body)
   58            ? request.body
   59            : Buffer.alloc(0);
   60          const query = QuerySchema.safeParse(request.query);
   61          if (query.success) {
   62            if (
   63              host === undefined ||
   64              !host.verify(query.data.meeting, query.data.token)
   65            ) {
   66              return reply.code(401).send();
   67            }
   68            const meetingId = query.data.meeting;
   69            const body = parseJson(raw);
   70            // Handled in order per call, after the answer.
   71            void host.receive(meetingId, body).catch(() => undefined);
   72            return reply.code(204).send();
   73          }
   74          if (status === undefined || !status.verify(request.headers, raw)) {
   75            return reply.code(401).send();
   76          }
   77          void status.receive(parseJson(raw)).catch(() => undefined);
   78          return reply.code(204).send();
   79        },
   80      );
```

## `apps/api/src/http/inbound-email.ts` lines 70-90

```ts
   70
   71  /**
   72   * The password from `Authorization: Basic base64(user:password)`, compared
   73   * by digest so the comparison is constant-time whatever the lengths. The
   74   * user name is not a secret and is not checked.
   75   */
   76  export function basicAuthMatches(
   77    header: string | undefined,
   78    secret: string,
   79  ): boolean {
   80    if (header === undefined || header.length > 2048) return false;
   81    const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
   82    if (match?.[1] === undefined) return false;
   83    const decoded = Buffer.from(match[1], "base64").toString("utf8");
   84    const colon = decoded.indexOf(":");
   85    if (colon < 0) return false;
   86    return timingSafeEqual(digest(decoded.slice(colon + 1)), digest(secret));
   87  }
   88
   89  export function registerInboundEmailRoutes(
   90    app: FastifyInstance,
```

## `apps/api/src/http/inbound-email.ts` lines 145-180

```ts
  145      });
  146
  147      scope.post(
  148        INBOUND_EMAIL_POSTMARK_PATH,
  149        { bodyLimit: INBOUND_EMAIL_BODY_LIMIT_BYTES },
  150        async (request, reply) => {
  151          const secret = dependencies.webhookSecret;
  152          if (
  153            secret === undefined ||
  154            secret.length === 0 ||
  155            !inboundEmail.available
  156          ) {
  157            request.log.warn(
  158              { requestId: request.id },
  159              "inbound email refused: receiving is not configured",
  160            );
  161            return send(
  162              reply,
  163              createProblemDetails({
  164                code: "PROVIDER_UNAVAILABLE",
  165                requestId: request.id,
  166                detail: "Inbound email is not configured on this deployment.",
  167              }),
  168            );
  169          }
  170          if (!basicAuthMatches(request.headers.authorization, secret)) {
  171            request.log.warn(
  172              { requestId: request.id },
  173              "inbound email refused: credentials did not match",
  174            );
  175            return send(
  176              reply.header("WWW-Authenticate", 'Basic realm="inbound-email"'),
  177              createProblemDetails({
  178                code: "AUTHENTICATION_REQUIRED",
  179                requestId: request.id,
  180                detail: "The delivery could not be authenticated.",
```

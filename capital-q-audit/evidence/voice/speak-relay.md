# Evidence: apps/q-api/src/voice/routes.ts (lines 396-548)

- Original path: `apps/q-api/src/voice/routes.ts`
- Line range: 396-548 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: POST /v1/q/voice/speak relay to ElevenLabs.

```ts
  396    const speakRelay = dependencies.deepgram?.speakRelay;
  397    if (speakRelay !== undefined) {
  398      app.post(Q_VOICE_SPEAK_RELAY_PATH, async (request, reply) => {
  399        const header = request.headers.authorization;
  400        const token =
  401          typeof header === "string" && header.startsWith("Bearer ")
  402            ? header.slice("Bearer ".length).trim()
  403            : "";
  404        const restored =
  405          token.length === 0 ? null : await dependencies.bindings.restore(token);
  406        // Only a token issued as the provider's bearer speaks.
  407        const binding = restored?.thinkToken === token ? restored : null;
  408        if (binding === null) {
  409          request.log.warn(
  410            {
  411              reason: "NO_BINDING_FOR_TOKEN",
  412              boundCount: dependencies.bindings.size(),
  413              presented: token.length === 0 ? "" : voiceTokenFingerprint(token),
  414            },
  415            "voice speak relay refused",
  416          );
  417          return reply.code(401).send({
  418            type: "about:blank",
  419            title: "Unauthorized",
  420            status: 401,
  421            detail: "No voice session for this request.",
  422          });
  423        }
  424        const body = request.body;
  425        const text =
  426          body !== null &&
  427          typeof body === "object" &&
  428          typeof (body as { text?: unknown }).text === "string"
  429            ? (body as { text: string }).text
  430            : "";
  431        // Bounded by what Q can say in one turn, not by the one-way speech
  432        // route's per-request limit. The agent decides how much text it asks
  433        // for at once, and a whole spoken answer (up to SPOKEN_MAX_CHARS) sent
  434        // as one request used to be refused here: Q's words on screen, no
  435        // sound, and nothing in the log.
  436        if (text.trim().length === 0 || text.length > RELAY_MAX_CHARS) {
  437          request.log.warn(
  438            { reason: "SPEAK_TEXT_OUT_OF_BOUNDS", characters: text.length },
  439            "voice speak relay refused",
  440          );
  441          return reply.code(400).send({
  442            type: "about:blank",
  443            title: "Bad Request",
  444            status: 400,
  445            detail: "There is nothing to say.",
  446          });
  447        }
  448        const query = request.query;
  449        const outputFormat =
  450          query !== null &&
  451          typeof query === "object" &&
  452          typeof (query as { output_format?: unknown }).output_format === "string"
  453            ? (query as { output_format: string }).output_format
  454            : undefined;
  455
  456        /**
  457         * The agent hangs up on Q mid-sentence every time the person speaks
  458         * over it, which is barge-in working, not a fault. Left unhandled
  459         * that arrives here as an unhandled `ERR_STREAM_PREMATURE_CLOSE`,
  460         * the connection dies, and the agent reports it to the browser as
  461         * INTERNAL_SERVER_ERROR and drops the line (seen live). So the
  462         * request going away cancels the vendor call instead: the sentence
  463         * nobody is listening to any more is not paid for or waited on.
  464         */
  465        const gone = new AbortController();
  466        // The *response* closing unfinished is the agent dropping the
  467        // request. Not the request stream's own close, which fires as soon
  468        // as the body has been read and would cancel every sentence before
  469        // a byte of it was sent — the same trap the think route documents.
  470        reply.raw.on("close", () => {
  471          if (!reply.raw.writableFinished) gone.abort();
  472        });
  473
  474        let upstream: Response;
  475        try {
  476          upstream = await speakRelay.stream({
  477            voice: binding.voice,
  478            text,
  479            outputFormat,
  480            signal: gone.signal,
  481            // Keys this sentence's delivery cues and timing (CQ-VOICE-010);
  482            // from the binding, like the voice, never from the request.
  483            session: binding.voiceSessionId,
  484            ...(binding.speakerVoiceId === undefined
  485              ? {}
  486              : { voiceId: binding.speakerVoiceId }),
  487          });
  488        } catch (error: unknown) {
  489          if (gone.signal.aborted) {
  490            // Interrupted before the vendor answered. Nobody to tell.
  491            return reply;
  492          }
  493          request.log.warn({ err: error }, "voice speak relay unreachable");
  494          return reply.code(502).send({
  495            type: "about:blank",
  496            title: "Bad Gateway",
  497            status: 502,
  498            detail: "Q can't speak right now.",
  499          });
  500        }
  501        if (!upstream.ok || upstream.body === null) {
  502          // The vendor's status is for this log and nowhere else; the agent
  503          // is told only that the audio did not come.
  504          request.log.warn(
  505            { status: upstream.status },
  506            "voice speak relay refused upstream",
  507          );
  508          return reply.code(502).send({
  509            type: "about:blank",
  510            title: "Bad Gateway",
  511            status: 502,
  512            detail: "Q can't speak right now.",
  513          });
  514        }
  515        spokenLines.add(1, { voice: binding.voice });
  516        const audio = Readable.fromWeb(
  517          upstream.body as WebReadableStream<Uint8Array>,
  518        );
  519        // A sentence cut off in the middle is the ordinary shape of a
  520        // conversation, not something to log as a failure or to let bubble
  521        // out of this handler.
  522        audio.on("error", (error: NodeJS.ErrnoException) => {
  523          if (
  524            gone.signal.aborted ||
  525            error.code === "ERR_STREAM_PREMATURE_CLOSE"
  526          ) {
  527            return;
  528          }
  529          request.log.warn(
  530            { err: error },
  531            "voice speak relay stream ended early",
  532          );
  533        });
  534        gone.signal.addEventListener("abort", () => audio.destroy(), {
  535          once: true,
  536        });
  537        return (
  538          reply
  539            .code(200)
  540            .header(
  541              "content-type",
  542              upstream.headers.get("content-type") ?? "application/octet-stream",
  543            )
  544            // Audio of one sentence in one person's live conversation.
  545            .header("cache-control", "no-store")
  546            .send(audio)
  547        );
  548      });
```

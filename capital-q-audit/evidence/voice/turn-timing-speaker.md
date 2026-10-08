# Evidence: apps/q-api/src/voice/turn-timing.ts (lines 14-48)

- Original path: `apps/q-api/src/voice/turn-timing.ts`
- Line range: 14-48 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: What 'voice turn timed' measures.

```ts
   14  import type { VoiceTurnHandler } from "./turn.js";
   15  
   16  /**
   17   * Where a spoken turn's time goes (CQ-VOICE-010).
   18   *
   19   * One structured line per voice turn, "voice turn timed". All times are in
   20   * milliseconds from the moment the turn reached Q (the think request,
   21   * which the speech provider sends once it has decided the person has
   22   * finished):
   23   *
   24   *   reasoningStartMs  the first model call began
   25   *   reasoningEndMs    the last model call ended
   26   *   firstTextMs       Q's first words were handed to the provider
   27   *   endMs             the turn finished
   28   *   ttsRequestMs      the provider asked the speak relay for the first audio
   29   *   firstAudioMs      the first audio byte came back from the voice vendor
   30   *   speculation       adopted | cancelled | null: whether Q's answer was
   31   *                     started before the turn was read and then taken up
   32   *                     (latency2), with speculationReason when cancelled and
   33   *                     speculationDecidedMs when the reading decided it
   34   *
   35   * Each model call, application-API call and memory recall is listed with
   36   * its own start and duration, so that "slow" can be traced to its cause
   37   * rather than guessed at.
   38   *
   39   * Nothing the person said and nothing Q said is ever in this line. Only
   40   * times, counts, task classes, model codes and API route shapes (with
   41   * identifiers replaced) appear. It is operational telemetry. It is not
   42   * analytics and not audit.
   43   *
   44   * The time before the think request (the provider deciding the turn was
   45   * over) and playback in the browser are the provider's and the browser's
   46   * to report. The deployed-stack recipe says where to read them.
   47   */
   48  
```

# Evidence: apps/q-api/src/voice/turn-timing.ts (lines 362-405)

- Original path: `apps/q-api/src/voice/turn-timing.ts`
- Line range: 362-405 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: timedSpeaker forwards narrate/deferred but NOT facts.

```ts
  362  export function timedVoiceTurns(
  363    turn: VoiceTurnHandler,
  364    timings: VoiceTurnTimings,
  365  ): VoiceTurnHandler {
  366    return async (binding, transcript, signal, speaker) => {
  367      const timing = timings.begin(binding.voiceSessionId);
  368      const timedSpeaker: VoiceSpeaker = {
  369        providerConversationId: speaker.providerConversationId,
  370        get isOpen() {
  371          return speaker.isOpen;
  372        },
  373        speak: (response) => {
  374          if (typeof response === "string") {
  375            if (response.trim().length > 0) timing.spoke();
  376            return speaker.speak(response);
  377          }
  378          return speaker.speak(
  379            (async function* noted() {
  380              for await (const part of response) {
  381                if (part.trim().length > 0) timing.spoke();
  382                yield part;
  383              }
  384            })(),
  385          );
  386        },
  387        close: () => {
  388          speaker.close();
  389        },
  390        // Forwarded as they are: the duplex line voices the silence ladder
  391        // out of band through `narrate`. Dropped here, the beats fell into
  392        // the answer text instead and the line stayed silent while ask_q
  393        // worked (founder live 2026-10-07, narration polls held 12 s empty).
  394        ...(speaker.narrate === undefined ? {} : { narrate: speaker.narrate }),
  395        ...(speaker.deferred === undefined ? {} : { deferred: speaker.deferred }),
  396      };
  397      try {
  398        const outcome = await timings.run(timing, () =>
  399          turn(binding, transcript, signal, timedSpeaker),
  400        );
  401        timing.end(signal.aborted ? "INTERRUPTED" : outcome.kind);
  402        return outcome;
  403      } catch (error: unknown) {
  404        timing.end("FAILED");
  405        throw error;
```


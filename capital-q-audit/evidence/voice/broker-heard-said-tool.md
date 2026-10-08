# Evidence: apps/q-api/src/voice/duplex/broker.ts (lines 816-1017)

- Original path: `apps/q-api/src/voice/duplex/broker.ts`
- Line range: 816-1017 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: heard() routing; said() attribution and mirroring; tool() ask_q returns silent key.

```ts
  816      heard: async ({ actor, voiceSessionId, heard, signal }) => {
  817        const line = ownLine(actor, voiceSessionId);
  818        if (line === null) return null;
  819        line.lastActivityAt = now();
  820        const words = heard.transcript.trim().slice(0, ASK_Q_MAX_CHARS);
  821        const route =
  822          words.length === 0
  823            ? "SMALLTALK"
  824            : routeDuplexTurn(words, {
  825                guided: line.guided,
  826                awaitingApproval: line.awaitingApproval,
  827                cardInFocus: heard.cardInFocus === true,
  828              });
  829        if (words.length > 0) {
  830          openTurn(
  831            line,
  832            words,
  833            routedAs(route),
  834            heard.typed === true,
  835            heard.itemId,
  836          );
  837        }
  838        if (route !== "ASK_Q") return { route };
  839        if (line.turn !== null) line.turn.asked = true;
  840        const result = await askQ(
  841          line,
  842          words,
  843          signal ?? new AbortController().signal,
  844        );
  845        return {
  846          route: "ASK_Q",
  847          // The browser records this call on the line, then its output, so
  848          // the voice says Q's answer as the reply to their turn.
  849          callId: `cq_${randomUUID().replace(/-/g, "")}`,
  850          arguments: JSON.stringify({ request: words }),
  851          output: result.output,
  852          approvalPending: result.approvalPending,
  853          ...(result.silent === true ? { silent: true } : {}),
  854        };
  855      },
  856  
  857      said: ({ actor, voiceSessionId, said }) => {
  858        const line = ownLine(actor, voiceSessionId);
  859        if (line === null) return false;
  860        line.lastActivityAt = now();
  861        const text = said.text.trim();
  862        if (text.length === 0) return true;
  863        const current = line.turn;
  864        const routed: DuplexRoutedAs =
  865          current === null
  866            ? "model_only"
  867            : current.asked
  868              ? "ask_q"
  869              : current.routed;
  870        keep(line, "Q", text, routed, { providerRef: said.responseId });
  871        if (routed !== "ask_q" && claimsInability(text)) {
  872          logger.warn(
  873            { qVoiceSessionId: voiceSessionId, routed },
  874            "duplex voice claimed an inability without Q",
  875          );
  876        }
  877        if (stallsForPermission(text)) {
  878          logger.warn(
  879            { qVoiceSessionId: voiceSessionId, routed },
  880            "duplex voice asked leave instead of doing the task",
  881          );
  882        }
  883        if (current !== null && routed !== "ask_q") {
  884          // Q's next ask_q reads this exchange, and so do the history and
  885          // Q's recall: it is part of the conversation.
  886          line.history.push(
  887            { role: "user", content: current.words },
  888            { role: "agent", content: text.slice(0, SPOKEN_MAX) },
  889          );
  890          line.history.splice(
  891            0,
  892            Math.max(0, line.history.length - LINE_HISTORY_MAX),
  893          );
  894          const conversationId = line.binding.thread.conversationId;
  895          const store = dependencies.transcript;
  896          if (conversationId !== undefined && store !== undefined) {
  897            void store
  898              .mirror({
  899                actor,
  900                conversationId,
  901                messages: [
  902                  { role: "USER", content: current.words },
  903                  { role: "Q", content: text },
  904                ],
  905              })
  906              .catch((error: unknown) => {
  907                logger.warn(
  908                  { err: error, qVoiceSessionId: voiceSessionId },
  909                  "duplex model-only turn not mirrored",
  910                );
  911              });
  912          }
  913        }
  914        line.turn = null;
  915        return true;
  916      },
  917  
  918      tool: async ({ actor, voiceSessionId, call, signal }) => {
  919        const line = ownLine(actor, voiceSessionId);
  920        if (line === null) return null;
  921        line.lastActivityAt = now();
  922        const args = parseArguments(call.arguments);
  923        if (args === null) {
  924          return output({ ok: false, error: "The arguments were not valid." });
  925        }
  926        const abort = signal ?? new AbortController().signal;
  927  
  928        if (call.name === ASK_Q_TOOL_NAME) {
  929          const request = args.request;
  930          if (typeof request !== "string" || request.trim().length === 0) {
  931            return output({ ok: false, error: "Nothing was asked." });
  932          }
  933          // The model passed the turn to Q itself (a card reply that was
  934          // not one, small talk that was not, a turn heard without words).
  935          if (line.turn === null) {
  936            openTurn(
  937              line,
  938              request.trim().slice(0, ASK_Q_MAX_CHARS),
  939              "ask_q",
  940              false,
  941            );
  942          }
  943          if (line.turn !== null) line.turn.asked = true;
  944          return askQ(line, request, abort);
  945        }
  946  
  947        if (call.name === SET_LISTENING_TOOL_NAME && line.listening) {
  948          // BACKCHANNEL: the level is resolved here, deterministically, and
  949          // applied on the line at once; it is remembered only through the
  950          // memory Write Gate, whose quote check reads the provider's
  951          // transcript of the person, not the model's words.
  952          const change = args.change;
  953          if (!isListeningChange(change)) {
  954            return output({ ok: false, error: "That is not a change I know." });
  955          }
  956          const current = call.listening ?? Q_VOICE_LISTENING_DEFAULT;
  957          const level = nextListeningLevel(current, change);
  958          const quote =
  959            typeof args.quote === "string"
  960              ? args.quote.trim().slice(0, QUOTE_MAX)
  961              : "";
  962          let remembered = false;
  963          if (dependencies.listening !== undefined && quote.length >= 3) {
  964            try {
  965              remembered = await dependencies.listening.remember({
  966                actor,
  967                level,
  968                quote,
  969                heard: call.heard ?? [],
  970              });
  971            } catch (error: unknown) {
  972              logger.warn({ err: error }, "duplex listening level not kept");
  973            }
  974          }
  975          logger.info(
  976            { qVoiceSessionId: voiceSessionId, level, remembered },
  977            "duplex listening level changed",
  978          );
  979          return {
  980            ...output({
  981              ok: true,
  982              level,
  983              remembered,
  984              say: "Acknowledge it once, in a few words, then carry on.",
  985            }),
  986            listening: level,
  987          };
  988        }
  989  
  990        // The card tool is answered in the browser, where the card is; one
  991        // that reaches here had no card in focus to decide.
  992        if (call.name === DECIDE_CARD_TOOL_NAME) {
  993          return output({
  994            ok: false,
  995            error:
  996              "No card is in focus on their screen. Pass their words to ask_q instead.",
  997          });
  998        }
  999  
 1000        // Anything else must be a tool this line was offered, and runs only
 1001        // through the registry's pipeline (validate, authorise, bound).
 1002        if (!line.direct.has(call.name)) {
 1003          return output({
 1004            ok: false,
 1005            error: "That tool is not available in this conversation.",
 1006          });
 1007        }
 1008        const outcome = await tools.execute(
 1009          { callId: call.callId, name: call.name, arguments: args },
 1010          { ...line.context, signal: abort },
 1011        );
 1012        return output(
 1013          outcome.result.ok
 1014            ? { ok: true, data: outcome.result.data }
 1015            : { ok: false, error: outcome.result.error.safeMessage },
 1016        );
 1017      },
```


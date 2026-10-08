# Evidence: apps/q-api/src/voice/turn.ts (lines 1103-1316)

- Original path: `apps/q-api/src/voice/turn.ts`
- Line range: 1103-1316 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Q run stream to speech: deltas, completed (facts/speakable), approvals, failures.

```ts
 1103      async function* answer(): AsyncGenerator<string> {
 1104        for await (const item of qStream.open({
 1105          run: record,
 1106          afterSequence: 0,
 1107          // A run superseded while it streams (the person carried on with
 1108          // the same utterance) says nothing more.
 1109          signal: AbortSignal.any([signal, live.stop.signal]),
 1110        })) {
 1111          if (item.kind === "end") {
 1112            return;
 1113          }
 1114          const event = item.event;
 1115          switch (event.type) {
 1116            case "q.message.delta": {
 1117              // A delta is a whole sentence that has already been through
 1118              // the answer's guards, so `speakable` can do its work on it:
 1119              // several of its rules are anchored to a line or need a
 1120              // matching pair, and neither survives being handed half a
 1121              // sentence.
 1122              const spoken = speakable(event.data.text);
 1123              if (spoken.length === 0) {
 1124                break;
 1125              }
 1126              // The spoken cap applies to a streamed answer as it applies
 1127              // to a finished one: a listener can take in only so much, and
 1128              // the rest is on their screen either way.
 1129              if (spokenCharacters >= SPOKEN_MAX_CHARS) {
 1130                break;
 1131              }
 1132              streamedDeltas = true;
 1133              streamedRaw += `${event.data.text} `;
 1134              spokenCharacters += spoken.length + 1;
 1135              // Cue before the sentence is handed over, so the relay finds
 1136              // it when the provider asks to hear this sentence.
 1137              if (!laughed && WRITTEN_LAUGH.test(spoken)) {
 1138                laughed = true;
 1139                dependencies.performance?.perform(binding.voiceSessionId, [
 1140                  {
 1141                    sentence: spoken,
 1142                    reaction: "LAUGH",
 1143                    pauseAfter: false,
 1144                    pace: "NORMAL",
 1145                    emphasis: [],
 1146                  },
 1147                ]);
 1148              }
 1149              yield `${spoken} `;
 1150              // Q's own sentence ended on a laugh (founder live 2026-09-29:
 1151              // "it didn't really laugh"): the emoji is silent in speech, so
 1152              // the laugh is voiced after it, where a person laughs.
 1153              if (LAUGHING_FACE.test(event.data.text) && !laughed) {
 1154                laughed = true;
 1155                dependencies.performance?.perform(binding.voiceSessionId, [
 1156                  {
 1157                    sentence: LAUGH_LINE,
 1158                    reaction: "LAUGH",
 1159                    pauseAfter: false,
 1160                    pace: "NORMAL",
 1161                    emphasis: [],
 1162                  },
 1163                ]);
 1164                yield `${LAUGH_LINE} `;
 1165              }
 1166              break;
 1167            }
 1168            case "q.message.completed": {
 1169              // voice-cards: the answer and its blocks go to the person's
 1170              // room first, before anything is said.
 1171              dependencies.room?.publish(actor, {
 1172                runId,
 1173                conversationId: thread.conversationId ?? null,
 1174                source: "VOICE",
 1175                message: event.data.message,
 1176              });
 1177              // The screen follows Q's answer: a navigation or a client
 1178              // action it carries, after Q has said so (useFollowTurn).
 1179              const follow = followOfAnswer(event.data.message.blocks);
 1180              // PRESENCE: the answer's gestures go to the screen, which plays
 1181              // them against Q's voice (spec §5). Presentation only.
 1182              const gestures = event.data.message.gestures ?? [];
 1183              if (gestures.length > 0) {
 1184                dependencies.board?.record(binding.voiceSessionId, {
 1185                  ...dependencies.board.read(binding.voiceSessionId),
 1186                  presence: {
 1187                    answerId: event.data.message.messageId,
 1188                    gestures,
 1189                  },
 1190                });
 1191              }
 1192              if (follow.navigate !== null || follow.clientAction !== null) {
 1193                dependencies.board?.record(binding.voiceSessionId, {
 1194                  ...dependencies.board.read(binding.voiceSessionId),
 1195                  asking: null,
 1196                  navigate: follow.navigate,
 1197                  clientAction: follow.clientAction,
 1198                  handoff: null,
 1199                  degraded: false,
 1200                });
 1201              }
 1202              const text = event.data.message.text;
 1203              const blocks = event.data.message.blocks ?? [];
 1204              // Code composed these words for the screen (a fit sweep, a
 1205              // record opened, a page): the voice says their facts in its
 1206              // own words instead of reading the template aloud.
 1207              const facts =
 1208                !streamedDeltas && text !== undefined
 1209                  ? spokenFactsOf({
 1210                      asked: askedWords,
 1211                      text,
 1212                      blocks,
 1213                      shown: shownCards.get(binding),
 1214                    })
 1215                  : null;
 1216              const cards = shownCardsOf(blocks);
 1217              if (cards.length > 0) shownCards.set(binding, cards);
 1218              if (facts !== null) {
 1219                answerGiven = true;
 1220                yield await fromFacts(binding, facts, askedWords, speaker, {
 1221                  correlationId,
 1222                  signal,
 1223                });
 1224              } else if (!streamedDeltas && text !== undefined) {
 1225                answerGiven = true;
 1226                yield bounded(speakable(text));
 1227              } else if (text !== undefined) {
 1228                // The stream carries every sentence but the last, which only
 1229                // the completed message holds, and code's own closing lines
 1230                // (the could-not line, what was done, a status) are only
 1231                // there too: what the person has not heard yet is said now,
 1232                // as a reader reads it (voice parity, lead 2026-10-03).
 1233                const rest = speakable(
 1234                  unsaidPartOf({ text, spoken: streamedRaw }),
 1235                );
 1236                const room = SPOKEN_MAX_CHARS - spokenCharacters;
 1237                if (rest.length > 0 && room > 0) {
 1238                  answerGiven = true;
 1239                  spokenCharacters += rest.length + 1;
 1240                  yield bounded(rest, Math.max(room, 1));
 1241                }
 1242              }
 1243              break;
 1244            }
 1245            case "q.input.required":
 1246              // A rising "Hm?" before a question back, as a person asks
 1247              // (founder live 2026-09-29: a flat hm thinks, a rising one
 1248              // asks, a low one acknowledges); on some turns, never all.
 1249              if (Math.random() < QUESTION_BEAT_SHARE) {
 1250                yield `${Q_VOICE_QUESTION_BEAT} `;
 1251              }
 1252              yield event.data.clarification.options === undefined
 1253                ? event.data.clarification.question
 1254                : `${event.data.clarification.question} ${joinOptions(event.data.clarification.options)}?`;
 1255              break;
 1256            case "q.action.proposed":
 1257              // An approval is coming: the silence is theirs from here.
 1258              silence.approvalWaiting = true;
 1259              // What Q would do, in the words the approver reads on screen.
 1260              proposedSummary = event.data.proposal.summary;
 1261              break;
 1262            case "q.approval.required":
 1263              // Held until yes or no; the next thing the person says
 1264              // decides it, exactly as a tap would (CQ-Q-008).
 1265              pendingApproval.set(binding, {
 1266                approvalId: event.data.approvalId,
 1267                summary: proposedSummary,
 1268              });
 1269              yield proposedSummary === null
 1270                ? `I've prepared something that needs your approval. ${APPROVAL_QUESTION}`
 1271                : `${proposedSummary} ${APPROVAL_QUESTION}`;
 1272              // The run is paused for the person now; nothing more arrives
 1273              // until they decide. Waiting here held the think request
 1274              // open until its deadline, and the person read "Thinking"
 1275              // for a minute after Q had already asked (live, 2026-09-17).
 1276              terminal = true;
 1277              return;
 1278            case "q.run.failed":
 1279              terminal = true;
 1280              runFailed = true;
 1281              lastRunFailed.set(binding, true);
 1282              if (streamedDeltas) {
 1283                // The answer has been heard. A run that fails after that
 1284                // has failed at something the person never saw, and telling
 1285                // them Q hit a snag and to ask again, right after Q answered,
 1286                // reads as Q contradicting itself. The log has the reason.
 1287                logger.warn(
 1288                  { qRunId: runId, failureCode: event.data.failure.code },
 1289                  "run failed after its answer had been spoken; nothing more is said",
 1290                );
 1291                return;
 1292              }
 1293              // Q's own notice for this conversation when the core composed
 1294              // one (named by the subsystem, said once); the line's own
 1295              // ledger otherwise, so a repeat never sounds the same.
 1296              yield event.data.failure.notice ??
 1297                recoveryLine(event.data.failure.code, binding);
 1298              return;
 1299            case "q.run.completed":
 1300              terminal = true;
 1301              recoverySettled(binding);
 1302              return;
 1303            case "q.stage.changed":
 1304              // ADR 0062 (amends R38): the stage is what the silence ladder
 1305              // may say while nothing of the answer has been heard; it is
 1306              // never itself spoken as part of the answer.
 1307              silence.stage = event.data.stage;
 1308              silence.approvalWaiting =
 1309                event.data.stage === "WAITING_FOR_APPROVAL";
 1310              break;
 1311            case "q.run.started":
 1312            case "q.finding.available":
 1313              break;
 1314          }
 1315        }
 1316      }
```

# Evidence: apps/q-api/src/voice/turn.ts (lines 940-980)

- Original path: `apps/q-api/src/voice/turn.ts`
- Line range: 940-980 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: fromFacts: uses speaker.facts when present, else spokenReply rewrite.

```ts
  940    const fromFacts = async (
  941      binding: VoiceSessionBinding,
  942      facts: SpokenFacts,
  943      asked: string,
  944      speaker: VoiceSpeaker,
  945      context: { readonly correlationId: string; readonly signal: AbortSignal },
  946    ): Promise<string> => {
  947      const remember = (said: string) => {
  948        lastFromFacts.set(binding, said);
  949        return said;
  950      };
  951      if (speaker.facts !== undefined) {
  952        speaker.facts(facts);
  953        return remember(facts.fallback);
  954      }
  955      const replier = dependencies.spokenReply;
  956      if (replier === undefined || context.signal.aborted) {
  957        return remember(facts.fallback);
  958      }
  959      const reply = await replier.say({
  960        facts,
  961        asked,
  962        lastSaid: lastFromFacts.get(binding) ?? "",
  963        attribution: {
  964          tenantId: binding.actor.tenantId,
  965          userId: binding.actor.userId,
  966          correlationId: context.correlationId,
  967        },
  968        signal: context.signal,
  969      });
  970      logger.info(
  971        {
  972          qVoiceSessionId: binding.voiceSessionId,
  973          kind: facts.kind,
  974          source: reply.source,
  975          issues: reply.issues,
  976        },
  977        "a code-built answer was said from its facts",
  978      );
  979      return remember(reply.text);
  980    };
```

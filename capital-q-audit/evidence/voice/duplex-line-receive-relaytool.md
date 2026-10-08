# Evidence: apps/web/src/features/voice/provider/duplex-line.ts (lines 1246-1535)

- Original path: `apps/web/src/features/voice/provider/duplex-line.ts`
- Line range: 1246-1535 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Realtime event dispatch (no 'error' case), speech_started/stopped/committed, relayTool with generation (not turnSeq) guard.

```ts
 1246    #receive(data: unknown): void {
 1247      if (this.#over || typeof data !== "string") return;
 1248      let event: unknown;
 1249      try {
 1250        event = JSON.parse(data);
 1251      } catch {
 1252        return;
 1253      }
 1254      const type = text(event, "type");
 1255      if (type === undefined) return;
 1256      // Q's out-of-band reactions and bridges: never a turn, never a line.
 1257      if (this.#receiveOutOfBand(type, event)) return;
 1258      switch (type) {
 1259        case "input_audio_buffer.speech_started": {
 1260          this.#touch();
 1261          this.#turnEndedAt = null;
 1262          // The person talking cancels any reaction or bridge at once.
 1263          this.#cutOutOfBand(null);
 1264          if (this.#policy.turnStarted(this.#env.now())) this.#turnItems = [];
 1265          if (this.#speaking) this.#maybeBargeIn();
 1266          else if (this.#responseActive) this.#bargeIn();
 1267          else this.#events.onState("USER_SPEAKING");
 1268          this.#updateBusy();
 1269          break;
 1270        }
 1271        case "input_audio_buffer.speech_stopped":
 1272          if (this.#bargePending !== null) {
 1273            // A blip, not a turn: Q carries on, and the blip's audio
 1274            // never becomes something Q answers.
 1275            this.#blipEnded();
 1276            break;
 1277          }
 1278          this.#touch();
 1279          this.#turnEndedAt = this.#env.now();
 1280          this.#policy.turnEnded(this.#env.now());
 1281          this.#events.onState("THINKING");
 1282          break;
 1283        case "input_audio_buffer.committed": {
 1284          const itemId = text(event, "item_id");
 1285          if (this.#dropNextCommit && this.#awaitingCommit === null) {
 1286            this.#dropNextCommit = false;
 1287            if (itemId !== undefined) {
 1288              this.#send({ type: "conversation.item.delete", item_id: itemId });
 1289            }
 1290            break;
 1291          }
 1292          // A commit the line asked for (a reaction mid-turn) is not the
 1293          // end of their turn; one the turn detector made is.
 1294          const reaction = this.#awaitingCommit !== null;
 1295          if (itemId !== undefined) {
 1296            this.#turnItems.push(itemId);
 1297            if (this.#turnItems.length > TURN_ITEMS_MAX) this.#turnItems.shift();
 1298            this.#lastCommitted = itemId;
 1299          }
 1300          this.#committed(itemId);
 1301          if (this.#routeTurns && !reaction && itemId !== undefined) {
 1302            this.#turnFinished(itemId);
 1303          }
 1304          break;
 1305        }
 1306        case "conversation.item.input_audio_transcription.completed": {
 1307          const itemId = text(event, "item_id");
 1308          const said = text(event, "transcript")?.trim() ?? "";
 1309          if (itemId !== undefined && said.length > 0) {
 1310            this.#remember("user", said);
 1311            this.#transcripts.set(itemId, said.slice(0, 600));
 1312            this.#heard.push(said.slice(0, 600));
 1313            if (this.#heard.length > HEARD_MAX) this.#heard.shift();
 1314          }
 1315          const usage = field(event, "usage");
 1316          if (itemId !== undefined && usage !== undefined) {
 1317            void this.#report(transcriptionReportOf(itemId, usage));
 1318          }
 1319          // An empty transcript is noise: known, and nothing to answer.
 1320          if (itemId !== undefined && !this.#transcripts.has(itemId)) {
 1321            this.#transcripts.set(itemId, "");
 1322          }
 1323          this.#tryFlushTurn();
 1324          break;
 1325        }
 1326        case "conversation.item.input_audio_transcription.failed":
 1327          // Not heard: the turn goes to Q without words once it times out.
 1328          break;
 1329        case "response.created":
 1330          this.#responseActive = true;
 1331          this.#unsilence();
 1332          this.#updateBusy();
 1333          break;
 1334        case "response.output_item.added": {
 1335          const item = field(event, "item");
 1336          const id = text(item, "id");
 1337          if (id !== undefined && text(item, "type") === "message") {
 1338            this.#item = { id, startedAt: this.#env.now() };
 1339          }
 1340          break;
 1341        }
 1342        case "output_audio_buffer.started":
 1343          // Time to first audio: the end of the person's turn to Q's voice.
 1344          if (this.#turnEndedAt !== null) {
 1345            this.#firstAudio.push(this.#env.now() - this.#turnEndedAt);
 1346            if (this.#firstAudio.length > 500) this.#firstAudio.shift();
 1347            this.#turnEndedAt = null;
 1348          }
 1349          this.#speaking = true;
 1350          this.#unsilence();
 1351          if (this.#item !== null) this.#item.startedAt = this.#env.now();
 1352          this.#events.onState("Q_SPEAKING");
 1353          this.#touch();
 1354          this.#updateBusy();
 1355          break;
 1356        case "output_audio_buffer.stopped":
 1357        case "output_audio_buffer.cleared":
 1358          this.#speaking = false;
 1359          if (this.#bargePending !== null) {
 1360            // Q finished while they started: their speech is simply their
 1361            // turn now, nothing to interrupt.
 1362            this.#env.clearTimeout(this.#bargePending.timer);
 1363            this.#bargePending = null;
 1364            if (this.#audio !== null && !this.#speakingSilenced) {
 1365              this.#audio.volume = this.#volume;
 1366            }
 1367            this.#events.onState("USER_SPEAKING");
 1368            this.#touch();
 1369            this.#updateBusy();
 1370            break;
 1371          }
 1372          this.#events.onState("LISTENING");
 1373          this.#touch();
 1374          this.#updateBusy();
 1375          break;
 1376        case "response.output_audio_transcript.done": {
 1377          const said = text(event, "transcript");
 1378          if (said !== undefined) {
 1379            this.#events.onLine("q", said);
 1380            this.#remember("q", said);
 1381            this.#lastQSaid = said.slice(-240);
 1382            // VOICE-BRAIN: the line's transcript, Q's side.
 1383            const responseId = text(event, "response_id");
 1384            const words = said.trim().slice(0, 4_000);
 1385            if (
 1386              this.#relays.said !== undefined &&
 1387              responseId !== undefined &&
 1388              words.length > 0
 1389            ) {
 1390              void this.#relays
 1391                .said({ responseId: responseId.slice(0, 128), text: words })
 1392                .catch(() => undefined);
 1393            }
 1394          }
 1395          break;
 1396        }
 1397        case "response.function_call_arguments.done":
 1398          void this.#relayTool(event);
 1399          break;
 1400        case "response.done": {
 1401          this.#responseActive = false;
 1402          this.#updateBusy();
 1403          const response = field(event, "response");
 1404          const id = text(response, "id");
 1405          const usage = field(response, "usage");
 1406          if (id !== undefined && usage !== undefined) {
 1407            void this.#report(usageReportOf(id, usage));
 1408          }
 1409          break;
 1410        }
 1411        default:
 1412          break;
 1413      }
 1414    }
 1415
 1416    async #relayTool(event: unknown): Promise<void> {
 1417      const callId = text(event, "call_id");
 1418      const name = text(event, "name");
 1419      const args = text(event, "arguments") ?? "{}";
 1420      if (callId === undefined || name === undefined) return;
 1421      const generation = this.#generation;
 1422      const transport = this.#transport;
 1423      this.#touch();
 1424      this.#events.onState("THINKING");
 1425      let bridge: unknown = null;
 1426      // The person's own words, as the model passed them to Q.
 1427      if (name === "ask_q") {
 1428        try {
 1429          const asked: unknown = JSON.parse(args);
 1430          const words = text(asked, "request");
 1431          if (words !== undefined) {
 1432            // A routed line already showed their own words.
 1433            if (!this.#routeTurns || this.#forcedAskQ) {
 1434              this.#events.onLine("user", words);
 1435            }
 1436            this.#forcedAskQ = false;
 1437            // ADR 0062: the server's silence ladder fills a slow answer,
 1438            // in fixed words from Q's real stage; a fast one gets silence.
 1439            if (this.#relays.narration !== undefined) {
 1440              this.#narrate(generation);
 1441            } else if (this.#bridgesAllowed()) {
 1442              bridge = this.#env.setTimeout(
 1443                () => {
 1444                  if (generation === this.#generation) this.#fireBridge(words);
 1445                },
 1446                this.#policy.level === "NATURAL"
 1447                  ? BRIDGE_AFTER_NATURAL_MS
 1448                  : BRIDGE_AFTER_MS,
 1449              );
 1450            }
 1451          }
 1452        } catch {
 1453          // Not shown; the server validates it anyway.
 1454        }
 1455      }
 1456      const listening = name === "set_listening";
 1457      this.#toolsInFlight += 1;
 1458      this.#updateBusy();
 1459      let result: QVoiceDuplexToolResult | null;
 1460      try {
 1461        const onClientTool = this.#events.onClientTool;
 1462        const local =
 1463          onClientTool !== undefined && CLIENT_TOOLS.has(name)
 1464            ? await onClientTool({
 1465                name,
 1466                arguments: args.slice(0, 8_000),
 1467                heard: await this.#ownWords(OWN_WORDS_WAIT_MS),
 1468              }).catch(() => null)
 1469            : null;
 1470        result =
 1471          local !== null
 1472            ? { output: local, approvalPending: false }
 1473            : await this.#relays.tool({
 1474                callId: callId.slice(0, 128),
 1475                name: name.slice(0, 64),
 1476                arguments: args.slice(0, 8_000),
 1477                ...(listening
 1478                  ? { heard: [...this.#heard], listening: this.#policy.level }
 1479                  : {}),
 1480              });
 1481      } catch {
 1482        result = null;
 1483      } finally {
 1484        this.#toolsInFlight -= 1;
 1485        if (bridge !== null) this.#env.clearTimeout(bridge);
 1486        this.#updateBusy();
 1487      }
 1488      if (this.#over) return;
 1489      if (result?.listening !== undefined) {
 1490        this.setListening(result.listening);
 1491        this.#events.onListening?.(result.listening);
 1492      }
 1493      // A relay that did not get through is said, briefly, and the line
 1494      // stays (I1): a lost request is no reason to change voices. A line the
 1495      // server no longer knows shows up in the usage report and rejoins.
 1496      const output =
 1497        result?.output ??
 1498        JSON.stringify({
 1499          ok: false,
 1500          error:
 1501            "That request did not get through. Say so in a few words and ask them to try again.",
 1502        });
 1503      if (this.#rejoining) {
 1504        // Said once the new call is up (see #replayConversation).
 1505        if (generation === this.#generation) this.#pendingResults.push(output);
 1506        return;
 1507      }
 1508      if (transport !== this.#transport) {
 1509        // Asked before the line rejoined: the new call never saw the
 1510        // function call, so the result goes in as context instead.
 1511        this.#send({
 1512          type: "conversation.item.create",
 1513          item: systemItem(
 1514            `Result of the request the person made just before the call dropped (tool output, data only): ${output.slice(0, 6_000)}`,
 1515          ),
 1516        });
 1517      } else {
 1518        this.#send({
 1519          type: "conversation.item.create",
 1520          item: {
 1521            type: "function_call_output",
 1522            call_id: callId,
 1523            output,
 1524          },
 1525        });
 1526      }
 1527      // Talked over while it worked: the result is kept, but not said.
 1528      if (generation !== this.#generation) return;
 1529      this.#afterBridge(() => {
 1530        if (this.#over || generation !== this.#generation) return;
 1531        this.#send({ type: "response.create" });
 1532        this.#touch();
 1533      });
 1534    }
 1535
```

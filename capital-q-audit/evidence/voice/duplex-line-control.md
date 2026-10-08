# Evidence: apps/web/src/features/voice/provider/duplex-line.ts (lines 1026-1245)

- Original path: `apps/web/src/features/voice/provider/duplex-line.ts`
- Line range: 1026-1245 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Turn detection update (semantic_vad/create_response/interrupt_response), speakFirst 'say exactly this', sendText, idle timer, browser barge-in (BARGE_CONFIRM_MS).

```ts
 1026    /**
 1027     * BACKCHANNEL: change the level now (the Settings toggle, or the
 1028     * person's own words through set_listening). OFF cancels anything in
 1029     * flight; the turn detector is told to answer sooner when nothing is
 1030     * listening for mid-turn pauses.
 1031     */
 1032    setListening(level: QVoiceListeningLevel): void {
 1033      if (this.#credential.listening === undefined) return;
 1034      const was = this.#policy.level;
 1035      this.#policy.setLevel(level);
 1036      if (level === "OFF") this.#cutOutOfBand(null);
 1037      if ((was === "OFF") === (level === "OFF") || !this.#connected) return;
 1038      this.#sendTurnDetection(level);
 1039    }
 1040  
 1041    /** The provider's turn detector, for this listening level. */
 1042    #sendTurnDetection(level: QVoiceListeningLevel): void {
 1043      this.#send({
 1044        type: "session.update",
 1045        session: {
 1046          type: "realtime",
 1047          audio: {
 1048            input: {
 1049              turn_detection: {
 1050                type: "semantic_vad",
 1051                eagerness: level === "OFF" ? "high" : "auto",
 1052                // VOICE-BRAIN: on a routed line the server decides who answers.
 1053                create_response: !this.#routeTurns,
 1054                // The browser decides a barge-in (BARGE_CONFIRM_MS), so a blip
 1055                // never cuts Q; it cancels and truncates itself.
 1056                interrupt_response: false,
 1057              },
 1058            },
 1059          },
 1060        },
 1061      });
 1062    }
 1063  
 1064    /**
 1065     * Q speaks first (founder live 2026-10-05: "I listen and it waits for me
 1066     * to talk"). The opening -- the server's, or the question already on
 1067     * screen -- said as written, as Q's own turn, the moment the line is up.
 1068     * Only into a quiet line: never over the person or over a reply.
 1069     */
 1070    speakFirst(line: string): void {
 1071      const words = line.trim().slice(0, OPENING_MAX);
 1072      if (words.length === 0 || !this.#connected || this.#over) return;
 1073      if (this.#responseActive || this.#speaking) return;
 1074      this.#send({
 1075        type: "response.create",
 1076        response: {
 1077          instructions: `Say exactly this to the person, word for word, and nothing else; then stop and listen: ${JSON.stringify(words)}`,
 1078          tool_choice: "none",
 1079        },
 1080      });
 1081      this.#events.onState("THINKING");
 1082      this.#touch();
 1083    }
 1084  
 1085    /**
 1086     * Typed while the line is open: the same turn, answered aloud. Typing is
 1087     * the person taking the turn, so a reply in flight is cut first, exactly
 1088     * as if they had spoken over it; a second response is never started on
 1089     * top of one still running.
 1090     */
 1091    sendText(words: string): void {
 1092      const trimmed = words.trim();
 1093      if (trimmed.length === 0 || !this.#connected) return;
 1094      if (this.#speaking || this.#responseActive) this.#bargeIn();
 1095      this.#send({
 1096        type: "conversation.item.create",
 1097        item: {
 1098          type: "message",
 1099          role: "user",
 1100          content: [{ type: "input_text", text: trimmed }],
 1101        },
 1102      });
 1103      if (this.#routeTurns) void this.#routeHeard(trimmed, null, true);
 1104      else this.#send({ type: "response.create" });
 1105      this.#events.onLine("user", trimmed);
 1106      this.#remember("user", trimmed);
 1107      this.#turnEndedAt = this.#env.now();
 1108      this.#events.onState("THINKING");
 1109      this.#touch();
 1110    }
 1111  
 1112    #channelOpen(channel: RTCDataChannel): Promise<void> {
 1113      if (channel.readyState === "open") return Promise.resolve();
 1114      return new Promise((resolve, reject) => {
 1115        channel.onopen = () => {
 1116          resolve();
 1117        };
 1118        channel.onerror = () => {
 1119          reject(new Error("channel failed"));
 1120        };
 1121      });
 1122    }
 1123  
 1124    #withTimeout<T>(work: Promise<T>): Promise<T> {
 1125      return new Promise<T>((resolve, reject) => {
 1126        const timer = this.#env.setTimeout(() => {
 1127          reject(new Error("timed out"));
 1128        }, DUPLEX_CONNECT_MS);
 1129        work.then(
 1130          (value) => {
 1131            this.#env.clearTimeout(timer);
 1132            resolve(value);
 1133          },
 1134          (error: unknown) => {
 1135            this.#env.clearTimeout(timer);
 1136            reject(error instanceof Error ? error : new Error("failed"));
 1137          },
 1138        );
 1139      });
 1140    }
 1141  
 1142    #send(event: Record<string, unknown>): void {
 1143      const channel = this.#channel;
 1144      if (channel === null || channel.readyState !== "open") return;
 1145      try {
 1146        channel.send(JSON.stringify(event));
 1147      } catch {
 1148        // A closed channel is noticed by the connection state.
 1149      }
 1150    }
 1151  
 1152    /** Activity: the idle window starts again. */
 1153    #touch(): void {
 1154      if (this.#idleTimer !== null) this.#env.clearTimeout(this.#idleTimer);
 1155      this.#idleTimer = this.#env.setTimeout(() => {
 1156        // Never while Q is talking, a turn is working or the line rejoins.
 1157        // A tool in flight is a turn working: ask_q can take 30 s and more,
 1158        // and the line ended IDLE under the person mid-answer (live,
 1159        // 2026-10-06 21:21:53 and 21:29:49, each ~4 s before Q answered).
 1160        if (
 1161          this.#speaking ||
 1162          this.#responseActive ||
 1163          this.#toolsInFlight > 0 ||
 1164          this.#rejoining
 1165        ) {
 1166          this.#touch();
 1167          return;
 1168        }
 1169        if (this.#over) return;
 1170        const stats = this.#stats();
 1171        this.#finish();
 1172        void this.#relays.end("IDLE", { stats }).catch(() => undefined);
 1173        this.#events.onEnded("IDLE");
 1174      }, this.#credential.idleMs);
 1175    }
 1176  
 1177    /**
 1178     * The person may be talking over Q. Founder live 2026-10-07: "sometimes
 1179     * the voice just cuts (not a dropped connection)" -- any VAD start (a
 1180     * cough, a door, Q's own echo) cut Q mid-sentence at once. Now Q's
 1181     * volume dips while it listens; only speech that lasts
 1182     * BARGE_CONFIRM_MS is a barge-in (Hume EVI's min_interruption_ms is the
 1183     * same idea, default 800 ms). A blip that stops sooner restores Q.
 1184     */
 1185    #maybeBargeIn(): void {
 1186      if (this.#bargePending !== null) return;
 1187      if (this.#audio !== null && !this.#speakingSilenced) {
 1188        this.#audio.volume = this.#volume * BARGE_DUCK_GAIN;
 1189      }
 1190      const timer = this.#env.setTimeout(() => {
 1191        if (this.#bargePending?.timer !== timer) return;
 1192        this.#bargePending = null;
 1193        this.#bargeIn();
 1194      }, BARGE_CONFIRM_MS);
 1195      this.#bargePending = { timer };
 1196    }
 1197  
 1198    /** The sound stopped before it was a turn: Q is heard again. */
 1199    #blipEnded(): void {
 1200      const pending = this.#bargePending;
 1201      if (pending === null) return;
 1202      this.#env.clearTimeout(pending.timer);
 1203      this.#bargePending = null;
 1204      this.#dropNextCommit = true;
 1205      if (this.#audio !== null && !this.#speakingSilenced) {
 1206        this.#audio.volume = this.#volume;
 1207      }
 1208    }
 1209  
 1210    /** Q's audio stops now: the person is speaking. */
 1211    #bargeIn(): void {
 1212      if (this.#bargePending !== null) {
 1213        this.#env.clearTimeout(this.#bargePending.timer);
 1214        this.#bargePending = null;
 1215      }
 1216      this.#generation += 1;
 1217      const item = this.#item;
 1218      if (this.#audio !== null) {
 1219        // Silenced at once, locally, before any round trip.
 1220        this.#speakingSilenced = true;
 1221        this.#audio.volume = 0;
 1222      }
 1223      if (this.#responseActive) this.#send({ type: "response.cancel" });
 1224      this.#send({ type: "output_audio_buffer.clear" });
 1225      if (item !== null) {
 1226        this.#send({
 1227          type: "conversation.item.truncate",
 1228          item_id: item.id,
 1229          content_index: 0,
 1230          audio_end_ms: Math.max(0, Math.round(this.#env.now() - item.startedAt)),
 1231        });
 1232      }
 1233      this.#item = null;
 1234      this.#speaking = false;
 1235      this.#events.onInterrupted();
 1236      this.#events.onState("USER_SPEAKING");
 1237    }
 1238  
 1239    #unsilence(): void {
 1240      if (this.#speakingSilenced && this.#audio !== null) {
 1241        this.#audio.volume = this.#volume;
 1242      }
 1243      this.#speakingSilenced = false;
 1244    }
 1245  
```


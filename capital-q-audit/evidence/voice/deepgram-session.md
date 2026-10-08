# Evidence: apps/web/src/features/voice/provider/deepgram-session.ts (lines 57-116)

- Original path: `apps/web/src/features/voice/provider/deepgram-session.ts`
- Line range: 57-116 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Standard-line watches and barge-in constants.

```ts
   57  const SETTINGS_WITHIN_MS = 10_000;
   58  /** The relay's slowest vendor, its fallback, and a margin. */
   59  const SPEECH_WITHIN_MS = 10_000;
   60  /** "Thinking" with no reply at all gives way to listening after this. */
   61  export const THINKING_GIVE_UP_MS = 14_000;
   62  /** A working microphone produces frames continuously, silence included. */
   63  const FRAMES_WITHIN_MS = 4_000;
   64  /**
   65   * An unmuted microphone that has delivered no frame for this long is
   66   * dead (its track ended, its device went away, the system took it, or
   67   * its audio context was suspended in the background) and is re-acquired
   68   * on the same line. The capture delivers frames continuously, silence
   69   * included, so a gap this long is never just a quiet room.
   70   */
   71  export const MIC_SILENT_MS = 2_000;
   72  const MIC_CHECK_MS = 500;
   73  
   74  /**
   75   * How long an injected message may wait for its echo before it is
   76   * forgotten. Long enough for a slow provider, short enough that it cannot
   77   * silence something the person types later in the conversation.
   78   */
   79  const INJECTED_TTL_MS = 30_000;
   80  
   81  const INPUT_SAMPLE_RATE = 16_000;
   82  const OUTPUT_SAMPLE_RATE = 24_000;
   83  
   84  /**
   85   * Barge-in (acceptance J, 2026-09-24).
   86   *
   87   * The provider's "user started speaking" is the listening model deciding
   88   * a turn has begun, and the agent stops Q's reply there and then. The
   89   * speaker has to stop with it: it used to sample the microphone first and
   90   * cut only for a loud, sustained sound, but echo cancellation keeps the
   91   * level low while Q's own voice is in the room, so Q played on to the end
   92   * of its answer while the person talked over it.
   93   *
   94   * A sound that produced no words (a cough) is repaired afterwards: once
   95   * the microphone has been quiet for longer than the provider waits before
   96   * ending a turn, and still no words have come, the browser asks Q to carry
   97   * on with a cue the server treats as "go on" and the transcript never
   98   * shows. It used to fire 1.6 s after the cut whatever the person was
   99   * doing — mid-sentence, since words only arrive when the turn ends — and
  100   * the provider folded the cue into their sentence: "[continue] I'm not
  101   * saying…", answered as a separate turn each time the sentence grew.
  102   */
  103  const SPEECH_LEVEL = 0.02;
  104  /** The provider's end-of-turn timeout (4 s, deepgram.ts) plus a margin. */
  105  const REPAIR_AFTER_QUIET_MS = 4_400;
  106  const REPAIR_POLL_MS = 100;
  107  /** A repair not decided by then is dropped; the person can say "go on". */
  108  const REPAIR_GIVE_UP_MS = 20_000;
  109  const CONTINUE_SIGNAL = "[continue]";
  110  /**
  111   * Audio in flight when the agent stopped arrives within this. True only
  112   * because frames are read straight off the socket: behind the SDK's Blob
  113   * hop they reached this code seconds late, after the window had closed,
  114   * and the answer the person talked over played on.
  115   */
  116  const STALE_AUDIO_MS = 700;
```

# Evidence: apps/web/src/features/voice/provider/deepgram-session.ts (lines 324-560)

- Original path: `apps/web/src/features/voice/provider/deepgram-session.ts`
- Line range: 324-560 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Standard-line event handling: watches, repair cue, audio discard, playback.

```ts
  324        const greeting =
  325          typeof settings.agent.greeting === "string" &&
  326          settings.agent.greeting.trim().length > 0;
  327        let settingsWatch: number | null = null;
  328        let speechWatch: number | null = null;
  329        let speechWarned = false;
  330        const stopWatch = (handle: number | null) => {
  331          if (handle !== null) window.clearTimeout(handle);
  332          return null;
  333        };
  334        /** Q is about to be heard; if nothing comes out, say so once. */
  335        const expectSpeech = () => {
  336          if (speechWatch !== null || speechWarned) return;
  337          speechWatch = window.setTimeout(() => {
  338            speechWatch = null;
  339            if (liveRef.current !== live) return;
  340            speechWarned = true;
  341            console.warn("[voice] no audio for a reply Q gave");
  342            setState((current) =>
  343              current === "Q_SPEAKING" || current === "THINKING"
  344                ? "LISTENING"
  345                : current,
  346            );
  347            eventsRef.current.onError?.(PLAIN_ERRORS.speech);
  348          }, SPEECH_WITHIN_MS);
  349        };
  350        const speechHeard = () => {
  351          speechWatch = stopWatch(speechWatch);
  352        };
  353        /**
  354         * Their words went to Q and no reply came at all (a sound the server
  355         * ignored, a turn that produced nothing): never sit on "thinking"
  356         * (founder live 2026-10-02). Back to listening after a while.
  357         */
  358        let thinkingWatch: number | null = null;
  359        const watchThinking = () => {
  360          thinkingWatch = stopWatch(thinkingWatch);
  361          thinkingWatch = window.setTimeout(() => {
  362            thinkingWatch = null;
  363            if (liveRef.current !== live) return;
  364            setState((current) =>
  365              current === "THINKING" ? "LISTENING" : current,
  366            );
  367          }, THINKING_GIVE_UP_MS);
  368        };
  369        let lineUp = false;
  370        session.on("connected", () => {
  371          lineUp = true;
  372          setConnected(true);
  373          // The socket, not the agent: until the settings are applied every
  374          // frame waits in the SDK's queue and nobody is listening.
  375          settingsWatch = stopWatch(settingsWatch);
  376          settingsWatch = window.setTimeout(() => {
  377            settingsWatch = null;
  378            if (liveRef.current !== live) return;
  379            console.warn("[voice] the agent never applied its settings");
  380            fail(PLAIN_ERRORS.connection);
  381          }, SETTINGS_WITHIN_MS);
  382        });
  383        session.on("settings-applied", () => {
  384          noteEvent("settings-applied");
  385          settingsWatch = stopWatch(settingsWatch);
  386          setState((current) =>
  387            current === "CONNECTING" ? "LISTENING" : current,
  388          );
  389          // Q speaks first on an explicit start; that greeting has to be heard.
  390          if (greeting) expectSpeech();
  391        });
  392        session.on("warning", (message) => {
  393          // For the log only; what the person is told comes from the
  394          // watches, which judge by what was heard rather than by wording.
  395          noteEvent("warning");
  396          console.warn("voice agent warning", message.code, message.description);
  397        });
  398        session.on("conversation-text", (message) => {
  399          noteEvent(`conversation-text:${message.role}`);
  400          // A new line from either side: whatever follows is not the reply
  401          // that was talked over.
  402          discardUntilRef.current = 0;
  403          const role = message.role === "user" ? "user" : "q";
  404          let content = message.content;
  405          if (role === "user") {
  406            lastUserTextAtRef.current = Date.now();
  407            // The cue is this browser's own signal, never the person's
  408            // words, even when the provider folds it into them.
  409            content = withoutCue(content);
  410            if (content.length === 0) return;
  411            // Our own injected message coming back. It is already on screen;
  412            // adding it again is the duplicate turn.
  413            const waiting = injectedRef.current.findIndex(
  414              (item) => item.text === content,
  415            );
  416            if (waiting !== -1) {
  417              injectedRef.current.splice(waiting, 1);
  418              setState("THINKING");
  419              return;
  420            }
  421          }
  422          // A thinking "hm" is a sound, not a line of the conversation.
  423          // The silence ladder's tables come with the wire's contracts (W7).
  424          if (role === "q" && wire.Q_VOICE_THINKING_BEATS.has(content.trim())) {
  425            expectSpeech();
  426            return;
  427          }
  428          // W4b: the silence ladder's beats are voiced while Q works, never a
  429          // line of the conversation (nor of the saved transcript).
  430          if (role === "q") {
  431            content = wire.stripSilenceBeats(content);
  432            if (content.length === 0) {
  433              expectSpeech();
  434              return;
  435            }
  436          }
  437          addLine(role, content);
  438          // The swarm and the page pointer follow what Q says, as it says it.
  439          if (role === "q") announceQSaid(content);
  440          if (role === "user") {
  441            setState("THINKING");
  442            watchThinking();
  443          } else {
  444            thinkingWatch = stopWatch(thinkingWatch);
  445            expectSpeech();
  446          }
  447        });
  448        /** The pending cough repair, if one is waiting. */
  449        let repair: number | null = null;
  450        const cancelRepair = () => {
  451          if (repair !== null) window.clearInterval(repair);
  452          repair = null;
  453        };
  454        const repairFalseInterruption = () => {
  455          cancelRepair();
  456          const startedAt = Date.now();
  457          let lastLoudAt = startedAt;
  458          repair = window.setInterval(() => {
  459            const now = Date.now();
  460            if (
  461              liveRef.current !== live ||
  462              lastUserTextAtRef.current >= startedAt ||
  463              now - startedAt > REPAIR_GIVE_UP_MS
  464            ) {
  465              cancelRepair();
  466              return;
  467            }
  468            if (microphone.getInputVolume() >= SPEECH_LEVEL) lastLoudAt = now;
  469            if (now - lastLoudAt < REPAIR_AFTER_QUIET_MS) return;
  470            cancelRepair();
  471            session.injectUserMessage(CONTINUE_SIGNAL);
  472            setState("THINKING");
  473          }, REPAIR_POLL_MS);
  474        };
  475        session.on("user-started-speaking", () => {
  476          noteEvent("user-started-speaking");
  477          // The agent abandons its reply; its audio is not owed any more.
  478          speechHeard();
  479          // "Speaking" is what the player is doing, not what the flag says:
  480          // the flag drops a bounded time after the provider finishes
  481          // sending, and a long answer is still coming out of the speaker
  482          // well after that. Live, Q talked over the person to the end of
  483          // its answer because the flag had already dropped.
  484          const stillPlaying =
  485            speakingRef.current || player.getRemainingPlaybackTime() > 0.1;
  486          if (!stillPlaying) {
  487            setState("USER_SPEAKING");
  488            return;
  489          }
  490          // Q stops the moment the person starts. The agent has already
  491          // abandoned this reply; what is queued or still arriving for it is
  492          // obsolete.
  493          player.interrupt();
  494          speakingRef.current = false;
  495          discardUntilRef.current = Date.now() + STALE_AUDIO_MS;
  496          setState("INTERRUPTED");
  497          eventsRef.current.onInterrupted?.();
  498          repairFalseInterruption();
  499        });
  500        /**
  501         * The provider's own measure of each turn (CQ-VOICE-010): from the
  502         * end of the person's speech to Q's first audio, and its parts.
  503         * q-api's "voice turn timed" line starts where this one's think
  504         * stage starts, so the two together cover the whole turn. Seconds,
  505         * as the provider reports them; nothing the person said.
  506         */
  507        session.on("latency-report", (report) => {
  508          console.info("[voice] latency (s)", {
  509            stt: report.stt_latency,
  510            think: report.ttt_text_latency,
  511            tts: report.tts_latency,
  512            total: report.total_latency,
  513          });
  514        });
  515        session.on("agent-thinking", () => {
  516          noteEvent("agent-thinking");
  517          discardUntilRef.current = 0;
  518          setState("THINKING");
  519          // The agent's own "thinking" ends the same way: never for good
  520          // (live 2026-10-02: 2.5 min of "thinking" with no reply coming).
  521          watchThinking();
  522        });
  523        session.on("agent-started-speaking", () => {
  524          cancelRepair();
  525          expectSpeech();
  526          discardUntilRef.current = 0;
  527          speakingRef.current = true;
  528          setState("Q_SPEAKING");
  529        });
  530        session.on("audio", (chunk) => {
  531          speechHeard();
  532          if (Date.now() < discardUntilRef.current) return;
  533          // Audio after the stale window: the agent is still speaking, so
  534          // nothing needs repairing.
  535          cancelRepair();
  536          player.queue(chunk);
  537        });
  538        session.on("agent-audio-done", () => {
  539          // Nothing more is coming for this reply: play what is held now
  540          // rather than waiting out the jitter buffer.
  541          player.flush();
  542          // How the speaker kept up, for the console only (as the heartbeat):
  543          // a gap here is a break in Q's voice the person heard.
  544          console.info("[voice] playback", player.stats);
  545          const remaining = Math.max(0, player.getRemainingPlaybackTime());
  546          window.setTimeout(
  547            () => {
  548              if (liveRef.current !== live) return;
  549              speakingRef.current = false;
  550              setState((current) =>
  551                current === "Q_SPEAKING" ? "LISTENING" : current,
  552              );
  553            },
  554            Math.min(8_000, remaining * 1000 + 150),
  555          );
  556        });
  557        /**
  558         * A line that has failed is finished, and the person should be
  559         * picked back up rather than left reading about it.
  560         *
```


# Evidence: apps/web/src/features/voice/use-voice-interview.ts (lines 300-373)

- Original path: `apps/web/src/features/voice/use-voice-interview.ts`
- Line range: 300-373 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: onFallback renewal vs standard-line rules.

```ts
  300    const client = useVoiceSession({
  301      ...events,
  302      onLine: (line) => {
  303        if (line.role === "q") lastQLine.current = line.text;
  304        events.onLine?.(line);
  305      },
  306      onEnded: (reason) => {
  307        setLineStatus(null);
  308        ended(reason);
  309      },
  310      onLinkStatus: setLineStatus,
  311      // DUPLEX: the same thread carries on, on the standard voice, at once.
  312      // Resumed: Q does not greet again. The cap's one sentence, if any, is
  313      // shown once the standard line is up (talk clears the notice first).
  314      onFallback: (notice, cause) => {
  315        // Exactly one standard line per duplex line that fails: a second
  316        // report from the same line, or one from a line already replaced or
  317        // ended, opens nothing (live 2026-10-05: a second standard line came
  318        // up beside the first, both listening).
  319        const current = generation.current;
  320        if (
  321          liveGeneration.current !== current ||
  322          !liveDuplex.current ||
  323          fellBack.current === current
  324        ) {
  325          return;
  326        }
  327        fellBack.current = current;
  328        setLineStatus(null);
  329        // A line that reached its length is renewed on the same voice
  330        // (founder 2026-10-05: "the voice changed" at exactly 10 minutes):
  331        // the person hears no switch. Bounded, so a line that cannot stay up
  332        // still lands on the standard voice. The server still decides: past
  333        // the daily cap the new session is issued as the standard one.
  334        // Any line that drops (a network blip, a server restart that forgot
  335        // the line, the length limit) is renewed as a fresh fast line too
  336        // (founder 2026-10-06: "the voice dropped to the slow one" during a
  337        // deploy). Only the daily cap, or a line that keeps failing, lands on
  338        // the standard voice.
  339        // A line that never connected is not retried here: on a network
  340        // that blocks the fast line the standard voice must come quickly.
  341        const renew =
  342          cause !== undefined &&
  343          cause !== "CAP" &&
  344          cause !== "CONNECT" &&
  345          (cause === "MAX_LENGTH" ? notice === null : true) &&
  346          renewals.current < MAX_DUPLEX_RENEWALS;
  347        if (renew) renewals.current += 1;
  348        else duplexOff.current = true;
  349        // A lost line is said at once when the standard voice is on its way.
  350        const weak = !renew && notice === LINE_LOST_NOTICE;
  351        if (weak) setLinkStatus(LINE_LOST_NOTICE);
  352        const last = lastStart.current;
  353        const again = talkRef.current;
  354        if (last === null || again === null) {
  355          ended("dropped");
  356          return;
  357        }
  358        // Q carries on speaking first on the standard line: the question it
  359        // is asking, never a second welcome.
  360        void again({
  361          thread: last.thread,
  362          firstMessage: reopening(),
  363          resume: true,
  364          ...(renew ? {} : { duplex: false }),
  365        }).then(() => {
  366          if (notice !== null && !weak) setNotice(notice);
  367        });
  368      },
  369      onError: (message) => {
  370        setNotice(message);
  371        events.onError?.(message);
  372      },
  373    });
```

# Evidence: apps/web/src/features/voice/use-voice-interview.ts (lines 445-629)

- Original path: `apps/web/src/features/voice/use-voice-interview.ts`
- Line range: 445-629 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: talk(): session start; turn poll every 1.5 s via server action (same queue as duplex relays).

```ts
  445    const talk = useCallback<VoiceInterview["talk"]>(
  446      async ({
  447        thread,
  448        firstMessage,
  449        voice: requested,
  450        resume = false,
  451        duplex,
  452        lead,
  453      }) => {
  454        // This call is now the line the person wants; anything older still
  455        // on its way (a reconnect timer, an open waiting on the server)
  456        // stands down when it sees the generation has moved on.
  457        generation.current += 1;
  458        const mine = generation.current;
  459        clearReconnect();
  460        if (lead !== undefined) leadRef.current = lead;
  461        const chosen = requested ?? voice;
  462        // The previous line -- this surface's own or another's -- is ended
  463        // and awaited before the server is asked for the next one.
  464        await openVoiceLine(holder, async () => {
  465          if (!mounted.current || generation.current !== mine) return;
  466          setNotice(null);
  467          lastStart.current = { thread, firstMessage };
  468          const started = await startVoiceSessionAction({
  469            ...(resume ? { resume: true } : {}),
  470            ...(duplex === false || duplexOff.current ? { duplex: false } : {}),
  471            ...(thread.welcome === true ? { welcome: true } : {}),
  472            ...(thread.onboarding === undefined
  473              ? {}
  474              : { onboarding: thread.onboarding }),
  475            ...(thread.subjects === undefined
  476              ? {}
  477              : { subjects: thread.subjects }),
  478            ...(thread.conversationId === undefined
  479              ? {}
  480              : { conversationId: thread.conversationId }),
  481            ...(thread.organisationHint === undefined
  482              ? {}
  483              : { organisationHint: thread.organisationHint }),
  484            // R21: the screen the line opens on; moves follow below.
  485            screen: currentScreen(),
  486            // Heard and spoken in the person's own language.
  487            ...deviceLocale(),
  488            voice: chosen,
  489          });
  490          // Ended, superseded or unmounted while the server answered: this
  491          // line is never brought up.
  492          if (!mounted.current || generation.current !== mine) return;
  493          if (!started.ok) {
  494            setNotice(started.message);
  495            return;
  496          }
  497          setVoice(started.value.voice);
  498          sessionToken.current = started.value.sessionToken;
  499          setVoiceSessionId(started.value.voiceSessionId);
  500          setTurn(null);
  501          setActive(true);
  502          upSince.current = Date.now();
  503          liveGeneration.current = mine;
  504          liveDuplex.current = started.value.duplex !== undefined;
  505          /**
  506           * Q speaks first (founder live 2026-10-05: "I listen and it waits
  507           * for me to talk"). The server's opening when it composed one; on a
  508           * resumed thread it composes none, and Q says the caller's line --
  509           * the question already on screen -- or, failing that, the question
  510           * the surface says it is asking now. Never nothing when there is a
  511           * question to ask.
  512           */
  513          const opening =
  514            said(started.value.firstMessage) ??
  515            said(firstMessage) ??
  516            said(leadRef.current?.());
  517          await clientRef.current.start({
  518            credential:
  519              resume || !hasGreeting(started.value)
  520                ? withGreeting(started.value, opening)
  521                : started.value,
  522            firstMessage: opening,
  523          });
  524        });
  525      },
  526      [holder, voice],
  527    );
  528  
  529    useEffect(() => {
  530      talkRef.current = talk;
  531    }, [talk]);
  532  
  533    // A surface that goes away takes its line with it, and nothing it
  534    // scheduled (a reconnect) may open another afterwards.
  535    useEffect(() => {
  536      mounted.current = true;
  537      return () => {
  538        mounted.current = false;
  539        generation.current += 1;
  540        liveGeneration.current = null;
  541        clearReconnect();
  542        dropVoiceLine(holder);
  543      };
  544    }, [holder]);
  545  
  546    const end = useCallback(async () => {
  547      reset();
  548      // After any open still in progress, so an End pressed while connecting
  549      // is never followed by the line coming up.
  550      await endVoiceLine(holder, () => clientRef.current.end());
  551    }, [holder, reset]);
  552  
  553    // While talking, follow what Q is asking; a stale read is dropped.
  554    useEffect(() => {
  555      if (!active || voiceSessionId === null) {
  556        return;
  557      }
  558      let cancelled = false;
  559      let timer: ReturnType<typeof setTimeout> | undefined;
  560      // R21: the screen the server has for this line; sent again only when
  561      // the person has moved (a route, or the document open in the viewer).
  562      // R18: with the pitch moment on it, so a spoken "what is this about?"
  563      // is about the card and the moment on screen. The position is sent in
  564      // five-second steps: enough to find the passage, not a post a second.
  565      let sentScreen = JSON.stringify(currentScreen());
  566      const tick = async () => {
  567        const screen = currentScreen();
  568        const viewing = currentViewing();
  569        const screenKey = JSON.stringify([
  570          screen,
  571          viewing === undefined
  572            ? null
  573            : [viewing.mediaAssetId, Math.floor(viewing.positionSeconds / 5)],
  574        ]);
  575        if (screenKey !== sentScreen) {
  576          sentScreen = screenKey;
  577          void sendVoiceScreenAction(
  578            voiceSessionId,
  579            viewing === undefined ? screen : { ...screen, viewing },
  580            sessionToken.current,
  581          );
  582        }
  583        const read = await readVoiceTurnAction(
  584          voiceSessionId,
  585          sessionToken.current,
  586        );
  587        if (cancelled) {
  588          return;
  589        }
  590        if (read.ok) {
  591          // PRESENCE: the spoken answer's gestures, played against Q's voice
  592          // (announced once per answer, however often the board is read).
  593          const presence = read.value.presence;
  594          if (presence !== undefined) {
  595            announceQGestures({
  596              answerId: presence.answerId,
  597              gestures: presence.gestures,
  598              spoken: true,
  599              text: lastQLine.current,
  600            });
  601          }
  602          setTurn((current) =>
  603            current !== null && current.sequence >= read.value.sequence
  604              ? current
  605              : read.value,
  606          );
  607        } else if (read.gone === true) {
  608          // The server has let this session go while the socket is still
  609          // open here. Nothing said into it will ever be answered, so the
  610          // line is ended as dropped, which is what brings it back.
  611          cancelled = true;
  612          const gone = generation.current;
  613          void clientRef.current.end().then(() => {
  614            // Only if this is still the current line: a newer one is not
  615            // ended because an older session was let go.
  616            if (generation.current === gone) endedRef.current("dropped");
  617          });
  618          return;
  619        }
  620        timer = setTimeout(() => void tick(), TURN_POLL_MS);
  621      };
  622      void tick();
  623      return () => {
  624        cancelled = true;
  625        if (timer !== undefined) {
  626          clearTimeout(timer);
  627        }
  628      };
  629    }, [active, voiceSessionId]);
```


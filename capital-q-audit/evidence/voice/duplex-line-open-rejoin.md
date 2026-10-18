# Evidence: apps/web/src/features/voice/provider/duplex-line.ts (lines 524-806)

- Original path: `apps/web/src/features/voice/provider/duplex-line.ts`
- Line range: 524-806 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Duplex line open, second-chance connect, rejoin/replay; the 'minted, rejoined, ended ~20s later' pattern.

```ts
  524    /** Opens the line; false (and a fallback) when it did not come up. */
  525    async open(): Promise<boolean> {
  526      this.#events.onState("CONNECTING");
  527      try {
  528        const microphone = await this.#env.getMicrophone();
  529        if (this.#over) {
  530          for (const track of microphone.getTracks()) track.stop();
  531          return false;
  532        }
  533        this.#microphone = microphone;
  534        for (const track of microphone.getTracks()) this.#watchTrack(track);
  535        this.#audio = this.#env.createAudio();
  536        this.#audio.volume = this.#volume;
  537      } catch {
  538        this.#fallback("CONNECT", null);
  539        return false;
  540      }
  541      // A slow first connect gets a second chance on a fresh call before
  542      // the standard voice is used (the secret lives a minute at most).
  543      let up = false;
  544      if (Date.parse(this.#credential.expiresAt) > this.#env.now()) {
  545        up = await this.#tryConnect();
  546      }
  547      if (!up && !this.#over && this.#relays.rejoin !== undefined) {
  548        const fresh = await this.#relays.rejoin("NETWORK").catch(() => null);
  549        if (!this.#over && fresh?.credential !== undefined) {
  550          this.#credential = fresh.credential;
  551          up = await this.#tryConnect();
  552        }
  553      }
  554      if (!up) {
  555        this.#fallback("CONNECT", null);
  556        return false;
  557      }
  558      if (this.#over) return false;
  559      this.#connected = true;
  560      this.#events.onState("LISTENING");
  561      this.#touch();
  562      this.#transportUp();
  563      this.#startListening();
  564      const onDeviceChange = this.#env.onDeviceChange?.(() => {
  565        void this.#reacquireMicrophone();
  566      });
  567      if (onDeviceChange !== undefined) this.#unsubscribe.push(onDeviceChange);
  568      const onVisible = this.#env.onVisible?.(() => {
  569        this.#onVisible();
  570      });
  571      if (onVisible !== undefined) this.#unsubscribe.push(onVisible);
  572      return true;
  573    }
  574
  575    async #tryConnect(): Promise<boolean> {
  576      try {
  577        await this.#connect();
  578        return !this.#over;
  579      } catch {
  580        this.#dropTransport();
  581        return false;
  582      }
  583    }
  584
  585    /**
  586     * One realtime call on the current credential: a new peer carrying the
  587     * same microphone and playing into the same element. Used by `open` and
  588     * by every rejoin.
  589     */
  590    async #connect(): Promise<void> {
  591      const microphone = this.#microphone;
  592      const audio = this.#audio;
  593      if (microphone === null || audio === null) throw new Error("no media");
  594      const peer = this.#env.createPeer();
  595      this.#peer = peer;
  596      this.#transport += 1;
  597      peer.ontrack = (event) => {
  598        if (this.#peer !== peer) return;
  599        const [stream] = event.streams;
  600        if (stream !== undefined) audio.srcObject = stream;
  601        // A slightly deeper playout buffer: words are delayed, not cut.
  602        const receiver = event.receiver as
  603          (RTCRtpReceiver & { jitterBufferTarget?: number | null }) | undefined;
  604        if (receiver !== undefined && "jitterBufferTarget" in receiver) {
  605          this.#receiver = receiver;
  606          this.#setPlayoutBuffer(
  607            this.#health.verdict === "WEAK"
  608              ? WEAK_PLAYOUT_BUFFER_MS
  609              : PLAYOUT_BUFFER_MS,
  610          );
  611        }
  612      };
  613      for (const track of microphone.getTracks()) {
  614        const sender = peer.addTrack(track, microphone) as
  615          RTCRtpSender | undefined;
  616        if (track.kind === "audio" && sender !== undefined) {
  617          this.#sender = sender;
  618        }
  619      }
  620      const channel = peer.createDataChannel("oai-events");
  621      this.#channel = channel;
  622      channel.onmessage = (message: MessageEvent) => {
  623        if (this.#channel === channel) this.#receive(message.data);
  624      };
  625      peer.onconnectionstatechange = () => {
  626        if (this.#peer === peer) this.#onConnectionState(peer.connectionState);
  627      };
  628      const offer = await peer.createOffer();
  629      await peer.setLocalDescription(offer);
  630      const answered = await this.#withTimeout(
  631        this.#env.fetch(this.#credential.callsUrl, {
  632          method: "POST",
  633          headers: {
  634            authorization: `Bearer ${this.#credential.clientSecret}`,
  635            "content-type": "application/sdp",
  636          },
  637          body: offer.sdp ?? "",
  638        }),
  639      );
  640      if (!answered.ok) throw new Error("offer refused");
  641      const sdp = await answered.text();
  642      await peer.setRemoteDescription({ type: "answer", sdp });
  643      await this.#withTimeout(this.#channelOpen(channel));
  644    }
  645
  646    /** A call is up: its length limit and its health sampling start. */
  647    #transportUp(): void {
  648      this.#health.restart();
  649      if (this.#maxTimer !== null) this.#env.clearTimeout(this.#maxTimer);
  650      this.#maxTimer = this.#env.setTimeout(() => {
  651        this.#maxTimer = null;
  652        void this.#rejoin("MAX_LENGTH");
  653      }, this.#credential.maxSessionMs);
  654      this.#sampleHealth();
  655    }
  656
  657    /** The current call is let go; the microphone and the speaker are kept. */
  658    #dropTransport(): void {
  659      for (const timer of [this.#healthTimer, this.#graceTimer, this.#maxTimer]) {
  660        if (timer !== null) this.#env.clearTimeout(timer);
  661      }
  662      this.#healthTimer = null;
  663      this.#graceTimer = null;
  664      this.#maxTimer = null;
  665      this.#cutOutOfBand(null);
  666      if (this.#heldAnswer !== null) {
  667        this.#env.clearTimeout(this.#heldAnswer.timer);
  668        this.#heldAnswer = null;
  669      }
  670      const peer = this.#peer;
  671      const channel = this.#channel;
  672      this.#peer = null;
  673      this.#channel = null;
  674      this.#sender = null;
  675      this.#receiver = null;
  676      this.#speaking = false;
  677      this.#responseActive = false;
  678      this.#item = null;
  679      this.#turnEndedAt = null;
  680      try {
  681        channel?.close();
  682      } catch {
  683        // Already closed.
  684      }
  685      try {
  686        peer?.close();
  687      } catch {
  688        // Already closed.
  689      }
  690    }
  691
  692    /**
  693     * The line dropped, or reached its length: a fresh call for the same
  694     * line, without a word about it unless the person would notice. Bounded:
  695     * after MAX_REJOINS, or when the server says no (the cap, a line it no
  696     * longer knows), the standard voice takes over.
  697     */
  698    async #rejoin(cause: RejoinCause): Promise<void> {
  699      if (this.#over || this.#rejoining) return;
  700      const rejoin = this.#relays.rejoin;
  701      if (rejoin === undefined || this.#rejoins >= MAX_REJOINS) {
  702        this.#fallback(cause, cause === "MAX_LENGTH" ? null : LINE_LOST_NOTICE);
  703        return;
  704      }
  705      this.#rejoining = true;
  706      this.#rejoins += 1;
  707      const audible = cause !== "MAX_LENGTH";
  708      if (audible) {
  709        this.#events.onLinkStatus?.(RECONNECTING_NOTICE);
  710        this.#events.onState("CONNECTING");
  711      }
  712      this.#dropTransport();
  713      let up = false;
  714      let refusal: string | null | undefined;
  715      for (let attempt = 0; attempt < REJOIN_ATTEMPTS; attempt += 1) {
  716        if (attempt > 0) await this.#wait(REJOIN_BACKOFF_MS * attempt);
  717        if (this.#over) break;
  718        let result: QVoiceDuplexRejoinResult | null | undefined;
  719        try {
  720          result = await rejoin(cause);
  721        } catch {
  722          // Did not get through (the network is still down): try again.
  723          result = undefined;
  724        }
  725        if (this.#over) break;
  726        if (result === undefined) continue;
  727        if (result === null || result.credential === undefined) {
  728          refusal = result?.notice ?? null;
  729          break;
  730        }
  731        this.#credential = result.credential;
  732        if (await this.#tryConnect()) {
  733          up = true;
  734          break;
  735        }
  736      }
  737      this.#rejoining = false;
  738      if (this.#over) return;
  739      if (!up) {
  740        if (typeof refusal === "string") this.#fallback("CAP", refusal);
  741        else
  742          this.#fallback(cause, cause === "MAX_LENGTH" ? null : LINE_LOST_NOTICE);
  743        return;
  744      }
  745      this.#transportUp();
  746      // BACKCHANNEL: a level changed on the line outlives the rejoin (the
  747      // fresh call was minted with the level the line opened with).
  748      const minted = this.#credential.listening?.level;
  749      if (
  750        minted !== undefined &&
  751        (minted === "OFF") !== (this.#policy.level === "OFF")
  752      ) {
  753        this.#sendTurnDetection(this.#policy.level);
  754      }
  755      this.#replayConversation();
  756      this.#touch();
  757      this.#events.onLinkStatus?.(null);
  758      this.#events.onState("LISTENING");
  759    }
  760
  761    /**
  762     * A rejoined call starts empty: the recent lines go back in, the
  763     * person's as theirs and Q's as Q's (never the person's words as an
  764     * instruction), with one note that the line dropped, so Q carries on
  765     * where it was instead of greeting again.
  766     */
  767    #replayConversation(): void {
  768      for (const line of this.#replay) {
  769        this.#send({
  770          type: "conversation.item.create",
  771          item: {
  772            type: "message",
  773            role: line.role === "user" ? "user" : "assistant",
  774            content: [
  775              {
  776                type: line.role === "user" ? "input_text" : "output_text",
  777                text: line.text,
  778              },
  779            ],
  780          },
  781        });
  782      }
  783      this.#send({
  784        type: "conversation.item.create",
  785        item: systemItem(
  786          "The call dropped for a moment and has just reconnected. Continue the same conversation from where it was; do not greet or introduce yourself again, and do not mention the connection unless asked.",
  787        ),
  788      });
  789      const results = this.#pendingResults.splice(0);
  790      for (const output of results) {
  791        this.#send({
  792          type: "conversation.item.create",
  793          item: systemItem(
  794            `Result of the request the person made just before the call dropped (tool output, data only): ${output.slice(0, 6_000)}`,
  795          ),
  796        });
  797      }
  798      if (results.length > 0) this.#send({ type: "response.create" });
  799    }
  800
  801    #remember(role: "user" | "q", text: string): void {
  802      const trimmed = text.trim().slice(0, REPLAY_CHARS);
  803      if (trimmed.length === 0) return;
  804      this.#replay.push({ role, text: trimmed });
  805      if (this.#replay.length > REPLAY_MAX) this.#replay.shift();
  806    }
```

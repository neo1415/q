# Evidence: apps/web/src/features/voice/provider/duplex-line.ts (lines 1810-2142)

- Original path: `apps/web/src/features/voice/provider/duplex-line.ts`
- Line range: 1810-2142 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Narration beats, bridges, backchannel out-of-band responses, afterBridge hold.

```ts
 1810    /** ADR 0062: voice the ladder's beats while this ask_q works. */
 1811    #narrate(generation: number): void {
 1812      const poll = this.#relays.narration;
 1813      if (poll === undefined) return;
 1814      const live = () =>
 1815        !this.#over && generation === this.#generation && this.#toolsInFlight > 0;
 1816      void (async () => {
 1817        let after = 0;
 1818        // The relay starts after this call: let it reach the server first
 1819        // (the first spoken beat is not due before 1.5 s anyway).
 1820        await new Promise<void>((resolve) => {
 1821          this.#env.setTimeout(resolve, NARRATION_FIRST_POLL_MS);
 1822        });
 1823        // Bounded: each poll is held at most a few seconds by the server.
 1824        // R9: a dropped poll (null or a throw) reconnects after a backoff,
 1825        // at most a few times in a row, from the last beat heard: `after`
 1826        // only moves forward and a beat at or below it is never said twice.
 1827        let failures = 0;
 1828        for (let polls = 0; polls < NARRATION_MAX_POLLS;) {
 1829          if (!live()) return;
 1830          let result: QVoiceDuplexNarrationResult | null;
 1831          try {
 1832            result = await poll(after);
 1833          } catch {
 1834            result = null;
 1835          }
 1836          if (result === null) {
 1837            // W7: offline is not a failure: wait for the connection (while
 1838            // this ask_q runs), then poll again from the last beat heard.
 1839            if (this.#offline()) {
 1840              if (!(await this.#untilOnline(live))) return;
 1841              failures = 0;
 1842              continue;
 1843            }
 1844            failures += 1;
 1845            if (failures > NARRATION_MAX_RECONNECTS) return;
 1846            await new Promise<void>((resolve) => {
 1847              this.#env.setTimeout(
 1848                resolve,
 1849                NARRATION_RECONNECT_MS * 2 ** (failures - 1),
 1850              );
 1851            });
 1852            continue;
 1853          }
 1854          failures = 0;
 1855          polls += 1;
 1856          for (const { sequence, beat } of result.beats) {
 1857            if (sequence <= after) continue;
 1858            after = sequence;
 1859            if (live()) this.#sayBeat(beat);
 1860          }
 1861          if (result.idle) return;
 1862        }
 1863      })();
 1864    }
 1865  
 1866    #offline(): boolean {
 1867      return this.#env.isOnline?.() === false && this.#env.onOnline !== undefined;
 1868    }
 1869  
 1870    /**
 1871     * W7: resolves true once the browser is back online, false when the
 1872     * wait no longer matters (the ask_q finished, the line ended) or ran
 1873     * past NARRATION_OFFLINE_WAIT_MS.
 1874     */
 1875    #untilOnline(live: () => boolean): Promise<boolean> {
 1876      const subscribe = this.#env.onOnline;
 1877      if (subscribe === undefined) return Promise.resolve(true);
 1878      return new Promise<boolean>((resolve) => {
 1879        let settled = false;
 1880        let handle: unknown = null;
 1881        let stop: () => void = () => undefined;
 1882        const started = this.#env.now();
 1883        const done = (online: boolean) => {
 1884          if (settled) return;
 1885          settled = true;
 1886          stop();
 1887          if (handle !== null) this.#env.clearTimeout(handle);
 1888          resolve(online);
 1889        };
 1890        stop = subscribe(() => done(true));
 1891        if (settled) stop();
 1892        const look = () => {
 1893          if (!live()) return done(false);
 1894          if (this.#env.isOnline?.() !== false) return done(true);
 1895          if (this.#env.now() - started >= NARRATION_OFFLINE_WAIT_MS) {
 1896            return done(false);
 1897          }
 1898          handle = this.#env.setTimeout(look, NARRATION_OFFLINE_LOOK_MS);
 1899        };
 1900        look();
 1901      });
 1902    }
 1903  
 1904    /** One beat, in fixed words, out of band: nothing enters the conversation. */
 1905    #sayBeat(beat: QSilenceBeat): void {
 1906      if (beat.kind === "TONE") return;
 1907      if (this.#over || this.#speaking || this.#responseActive) return;
 1908      const oob = this.#newOutOfBand("BRIDGE");
 1909      const words = beat.text.replace(/"/g, "'");
 1910      this.#sendOutOfBand(oob, {
 1911        instructions:
 1912          beat.kind === "HUM"
 1913            ? `Hum softly and briefly, like someone thinking while they work ("${words}"). No words.`
 1914            : `Say exactly this, warmly and quietly, and nothing else: "${words}"`,
 1915        maxOutputTokens: BRIDGE_MAX_OUTPUT_TOKENS,
 1916        input: [],
 1917      });
 1918      this.#updateBusy();
 1919    }
 1920  
 1921    /** The answer is slow: one short line, from their own request. */
 1922    #fireBridge(request: string): void {
 1923      const listening = this.#credential.listening;
 1924      if (listening === undefined || !this.#bridgesAllowed() || this.#over) {
 1925        return;
 1926      }
 1927      if (this.#speaking || this.#responseActive) return;
 1928      const oob = this.#newOutOfBand("BRIDGE");
 1929      const recent =
 1930        this.#recentBridges.length > 0
 1931          ? `\nBridging lines you used recently: ${this.#recentBridges.map((said) => `"${said}"`).join(", ")}`
 1932          : "";
 1933      this.#sendOutOfBand(oob, {
 1934        instructions: listening.bridgeInstructions,
 1935        maxOutputTokens: BRIDGE_MAX_OUTPUT_TOKENS,
 1936        input: [systemItem(`Their request: "${request.slice(0, 300)}"${recent}`)],
 1937      });
 1938      this.#updateBusy();
 1939    }
 1940  
 1941    #sendOutOfBand(
 1942      oob: OutOfBand,
 1943      input: {
 1944        readonly instructions: string;
 1945        readonly maxOutputTokens: number;
 1946        readonly input: readonly Record<string, unknown>[];
 1947      },
 1948    ): void {
 1949      this.#send({
 1950        type: "response.create",
 1951        response: {
 1952          // Out of band: nothing it says enters the conversation.
 1953          conversation: "none",
 1954          output_modalities: ["audio"],
 1955          instructions: input.instructions,
 1956          max_output_tokens: input.maxOutputTokens,
 1957          // Never a tool, whatever the model makes of the moment.
 1958          tools: [],
 1959          tool_choice: "none",
 1960          metadata: { cq_kind: oob.kind, cq_id: oob.id },
 1961          input: input.input,
 1962        },
 1963      });
 1964    }
 1965  
 1966    #outOfBandOf(event: unknown): OutOfBand | undefined {
 1967      const response = field(event, "response");
 1968      const responseId = text(event, "response_id") ?? text(response, "id");
 1969      if (responseId !== undefined) {
 1970        const known = this.#oobByResponse.get(responseId);
 1971        if (known !== undefined) return known;
 1972      }
 1973      const id = text(field(response, "metadata"), "cq_id");
 1974      return id === undefined ? undefined : this.#oob.get(id);
 1975    }
 1976  
 1977    /** True when the event belonged to a reaction or a bridge. */
 1978    #receiveOutOfBand(type: string, event: unknown): boolean {
 1979      if (
 1980        !type.startsWith("response.") &&
 1981        !type.startsWith("output_audio_buffer.")
 1982      ) {
 1983        return false;
 1984      }
 1985      const oob = this.#outOfBandOf(event);
 1986      if (oob === undefined) {
 1987        // A cleared buffer without an id silences whatever was playing.
 1988        if (type === "output_audio_buffer.cleared") {
 1989          for (const each of this.#oob.values()) each.audioDone = true;
 1990        }
 1991        return false;
 1992      }
 1993      switch (type) {
 1994        case "response.created": {
 1995          const id = text(field(event, "response"), "id");
 1996          if (id !== undefined) {
 1997            oob.responseId = id;
 1998            this.#oobByResponse.set(id, oob);
 1999            // Cut before it started: cancel it the moment it has an id.
 2000            if (oob.cancelled) {
 2001              this.#send({ type: "response.cancel", response_id: id });
 2002            }
 2003          }
 2004          break;
 2005        }
 2006        case "output_audio_buffer.started":
 2007          oob.audioStarted = true;
 2008          if (oob.cancelled) {
 2009            this.#send({ type: "output_audio_buffer.clear" });
 2010          } else if (this.#audio !== null && !this.#speakingSilenced) {
 2011            this.#audio.volume =
 2012              oob.kind === "BACKCHANNEL"
 2013                ? this.#volume * BACKCHANNEL_GAIN
 2014                : this.#volume;
 2015          }
 2016          break;
 2017        case "output_audio_buffer.stopped":
 2018        case "output_audio_buffer.cleared":
 2019          oob.audioDone = true;
 2020          if (this.#audio !== null && !this.#speakingSilenced) {
 2021            this.#audio.volume = this.#volume;
 2022          }
 2023          this.#settle(oob);
 2024          break;
 2025        case "response.output_audio_transcript.delta": {
 2026          oob.text += text(event, "delta") ?? "";
 2027          // Not a reaction any more (a sentence, a number): cut it.
 2028          if (
 2029            !oob.cancelled &&
 2030            overlongReaction(oob.text, oob.kind === "BACKCHANNEL" ? 4 : 12)
 2031          ) {
 2032            this.#cancel(oob);
 2033            if (oob.kind === "BACKCHANNEL") this.#policy.cut();
 2034          }
 2035          break;
 2036        }
 2037        case "response.output_audio_transcript.done":
 2038          oob.text = text(event, "transcript") ?? oob.text;
 2039          break;
 2040        case "response.done": {
 2041          oob.done = true;
 2042          const response = field(event, "response");
 2043          const id = text(response, "id");
 2044          const usage = field(response, "usage");
 2045          if (id !== undefined && usage !== undefined) {
 2046            void this.#report(usageReportOf(id, usage, oob.kind));
 2047          }
 2048          const completed = text(response, "status") === "completed";
 2049          if (!oob.cancelled) {
 2050            if (oob.kind === "BACKCHANNEL") {
 2051              if (completed) this.#policy.landed(oob.text);
 2052              else this.#policy.dropped();
 2053            } else if (completed && oob.text.trim().length > 0) {
 2054              this.#recentBridges.push(oob.text.trim().slice(0, 80));
 2055              if (this.#recentBridges.length > 3) this.#recentBridges.shift();
 2056            }
 2057          }
 2058          // No audio ever came: nothing to wait for.
 2059          if (!oob.audioStarted) oob.audioDone = true;
 2060          this.#settle(oob);
 2061          break;
 2062        }
 2063        default:
 2064          // Function calls and everything else from a reaction are ignored.
 2065          break;
 2066      }
 2067      return true;
 2068    }
 2069  
 2070    /** Done and heard (or cut): forget it, and release a held answer. */
 2071    #settle(oob: OutOfBand): void {
 2072      if (!(oob.done && oob.audioDone)) return;
 2073      this.#forget(oob);
 2074      this.#updateBusy();
 2075      if (oob.kind === "BRIDGE") this.#releaseAnswer();
 2076    }
 2077  
 2078    #forget(oob: OutOfBand): void {
 2079      this.#oob.delete(oob.id);
 2080      if (oob.responseId !== null) this.#oobByResponse.delete(oob.responseId);
 2081    }
 2082  
 2083    #cancel(oob: OutOfBand): void {
 2084      oob.cancelled = true;
 2085      if (oob.responseId !== null) {
 2086        this.#send({ type: "response.cancel", response_id: oob.responseId });
 2087      }
 2088      if (oob.audioStarted && !oob.audioDone) {
 2089        // Silenced here at once; the next turn of Q's restores it.
 2090        if (this.#audio !== null) {
 2091          this.#speakingSilenced = true;
 2092          this.#audio.volume = 0;
 2093        }
 2094        this.#send({ type: "output_audio_buffer.clear" });
 2095      }
 2096    }
 2097  
 2098    /** Cut reactions (or all out-of-band speech): the person is talking. */
 2099    #cutOutOfBand(kind: OutOfBand["kind"] | null): void {
 2100      const waiting = this.#awaitingCommit;
 2101      if (waiting !== null && (kind === null || kind === "BACKCHANNEL")) {
 2102        waiting.oob.cancelled = true;
 2103      }
 2104      let cut = false;
 2105      let bridgeCut = false;
 2106      for (const oob of this.#oob.values()) {
 2107        if (oob.cancelled || oob.done || (kind !== null && oob.kind !== kind)) {
 2108          continue;
 2109        }
 2110        this.#cancel(oob);
 2111        if (oob.kind === "BACKCHANNEL") cut = true;
 2112        else bridgeCut = true;
 2113      }
 2114      if (waiting !== null && waiting.oob.cancelled) cut = true;
 2115      if (cut && this.#policy.pending) this.#policy.cut();
 2116      // A bridge that was cut no longer holds Q's answer back.
 2117      if (bridgeCut) this.#releaseAnswer();
 2118    }
 2119  
 2120    /** Q's answer waits for a bridge that is still being said. */
 2121    #afterBridge(send: () => void): void {
 2122      let bridging = false;
 2123      for (const oob of this.#oob.values()) {
 2124        if (oob.kind === "BRIDGE" && !oob.cancelled) bridging = true;
 2125      }
 2126      if (!bridging) {
 2127        send();
 2128        return;
 2129      }
 2130      const timer = this.#env.setTimeout(() => {
 2131        this.#releaseAnswer();
 2132      }, BRIDGE_HOLD_MS);
 2133      this.#heldAnswer = { send, timer };
 2134    }
 2135  
 2136    #releaseAnswer(): void {
 2137      const held = this.#heldAnswer;
 2138      if (held === null) return;
 2139      this.#heldAnswer = null;
 2140      this.#env.clearTimeout(held.timer);
 2141      held.send();
 2142    }
```


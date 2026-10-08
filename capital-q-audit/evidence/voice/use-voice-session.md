# Evidence: apps/web/src/features/voice/use-voice-session.ts (lines 34-132)

- Original path: `apps/web/src/features/voice/use-voice-session.ts`
- Line range: 34-132 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Transport choice: duplex first when credential carries duplex; else provider (deepgram|elevenlabs); away-pause.

```ts
   34    events: VoiceSessionEvents = {},
   35  ): VoiceSessionClient {
   36    const elevenLabs = useElevenLabsVoiceSession(events);
   37    const deepgram = useDeepgramVoiceSession(events);
   38    const duplex = useDuplexVoiceSession(events);
   39    const [active, setActive] = useState<"elevenlabs" | "deepgram" | "duplex">(
   40      "elevenlabs",
   41    );
   42    const client =
   43      active === "duplex"
   44        ? duplex
   45        : active === "deepgram"
   46          ? deepgram
   47          : elevenLabs;
   48    const [pausedAway, setPausedAway] = useState(false);
   49
   50    const start = useCallback(
   51      async (input: VoiceSessionStart) => {
   52        const provider = input.credential.provider ?? "elevenlabs";
   53        setPausedAway(false);
   54        // DUPLEX: the full-duplex line first when the server brokered one;
   55        // if it does not come up, the standard line on the same credential,
   56        // at once and without a word to the person.
   57        if (input.credential.duplex !== undefined) {
   58          setActive("duplex");
   59          if (await duplex.start(input)) return;
   60        }
   61        setActive(provider);
   62        await (provider === "deepgram" ? deepgram : elevenLabs).start(input);
   63      },
   64      [deepgram, duplex, elevenLabs],
   65    );
   66
   67    const transportSetMuted = client.setMuted;
   68    const setMuted = useCallback(
   69      (next: boolean) => {
   70        // The person's own choice, either way, ends an away pause.
   71        setPausedAway(false);
   72        transportSetMuted(next);
   73      },
   74      [transportSetMuted],
   75    );
   76
   77    const live = useRef({ connected: false, muted: false });
   78    useEffect(() => {
   79      live.current = { connected: client.connected, muted: client.muted };
   80    }, [client.connected, client.muted]);
   81
   82    useEffect(() => {
   83      if (typeof document === "undefined") return;
   84      let blurTimer: ReturnType<typeof setTimeout> | null = null;
   85      const pause = () => {
   86        if (!live.current.connected || live.current.muted) return;
   87        transportSetMuted(true);
   88        setPausedAway(true);
   89      };
   90      const onVisibility = () => {
   91        if (document.visibilityState === "hidden") pause();
   92      };
   93      const onBlur = () => {
   94        if (blurTimer !== null) clearTimeout(blurTimer);
   95        blurTimer = setTimeout(pause, AWAY_BLUR_PAUSE_MS);
   96      };
   97      const onFocus = () => {
   98        if (blurTimer !== null) clearTimeout(blurTimer);
   99        blurTimer = null;
  100      };
  101      document.addEventListener("visibilitychange", onVisibility);
  102      document.addEventListener("freeze", pause);
  103      window.addEventListener("pagehide", pause);
  104      window.addEventListener("blur", onBlur);
  105      window.addEventListener("focus", onFocus);
  106      return () => {
  107        if (blurTimer !== null) clearTimeout(blurTimer);
  108        document.removeEventListener("visibilitychange", onVisibility);
  109        document.removeEventListener("freeze", pause);
  110        window.removeEventListener("pagehide", pause);
  111        window.removeEventListener("blur", onBlur);
  112        window.removeEventListener("focus", onFocus);
  113      };
  114    }, [transportSetMuted]);
  115
  116    /**
  117     * Every transport, not only the one shown: a duplex line that fell back
  118     * inside `start` leaves the standard one current, and an end that
  119     * reached only one of them could leave the other listening.
  120     */
  121    const endDuplex = duplex.end;
  122    const endDeepgram = deepgram.end;
  123    const endElevenLabs = elevenLabs.end;
  124    const end = useCallback(async () => {
  125      await Promise.all([endDuplex(), endDeepgram(), endElevenLabs()]);
  126    }, [endDuplex, endDeepgram, endElevenLabs]);
  127
  128    return useMemo(
  129      () => ({ ...client, start, end, setMuted, pausedAway }),
  130      [client, start, end, setMuted, pausedAway],
  131    );
  132  }
```

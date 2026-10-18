# Voice error propagation (investigator C)

How a failure at each layer reaches (or fails to reach) the person. Line refs at HEAD 520bd123.

## 1. Duplex

```mermaid
flowchart TD
    subgraph Provider["OpenAI Realtime"]
      E1["error event"]
      E2["response.done status failed/cancelled"]
      E3["transcription.failed"]
      E4["ICE failed / disconnected"]
    end
    subgraph Browser["duplex-line.ts"]
      R["receive switch 1258-1413"]
      TW["turnFinished wait 2.5 s"]
      FA["forceAskQ 1594"]
      RT["relayTool 1416"]
      RH["routeHeard 1604"]
      RJ["rejoin 698"]
      FB["fallback 2173"]
      ST["state THINKING, no watchdog"]
    end
    subgraph Actions["duplex-actions.ts server actions"]
      A1["catch -> null, no log 53-57, 70-74"]
    end
    subgraph Server["q-api"]
      HR["POST /duplex/heard"]
      TR["POST /duplex/tool -> strict parse 86"]
      BK["broker askQ catch -> ok:false 568-576"]
      SIL["answer.ts SILENT / not addressed"]
      MAP["in-process lines Map 453"]
    end
    E1 --> R -->|default: ignored| ST
    E2 --> R -->|usage only| ST
    E3 --> R -->|no log| TW --> FA
    E4 --> RJ -->|ok| R
    RJ -->|6 rejoins or refused| FB -->|onFallback| SL["standard line opened by use-voice-interview"]
    RH --> HR
    HR -->|404 line unknown| A1
    HR -->|ok| RH
    MAP -.restart / other replica.-> HR
    A1 -->|null| FA --> RT
    RT --> TR
    TR -->|silent key -> ZodError -> 500| A1
    A1 -->|null| MSG["model told: 'That request did not get through. Say so…' 1496-1502"]
    BK -->|ok:false| MSG2["model says 'That didn't go through on my side.'"]
    SIL -->|heard: silent:true| LIS["LISTENING, nothing said 1647-1652"]
    SIL -->|tool path| TR
    RH -->|transport changed after rejoin| DROP["answer dropped, THINKING 1654-1658"]
    RH -->|seq/generation changed| DROP2["answer dropped 1638"]
```

## 2. Standard line

```mermaid
flowchart TD
    subgraph Server["q-api"]
      TK["think route"]
      NB["401 no binding: releaseFor(user) / swept"]
      TF["turn throws"]
      DL["20 s deadline"]
      SR["speak relay"]
      S4["401/400/502"]
    end
    subgraph Deepgram
      AG["agent"]
      AE["agent error event"]
    end
    subgraph Browser["deepgram-session.ts"]
      W14["THINKING 14 s watchdog -> LISTENING"]
      W10["no audio 10 s -> 'I can't speak out loud right now'"]
      FL["fail -> ERROR + onEnded dropped"]
      RC["use-voice-interview reconnect 1.2/3/8 s"]
      GU["GAVE_UP notice"]
    end
    TK --> NB --> AG -->|no reply| W14
    TK --> TF -->|turnFailureLine spoken| AG
    TK --> DL -->|TURN_TOO_LONG spoken| AG
    TK -->|SILENT / NOTHING: empty stream| AG --> W14
    SR --> S4 --> AG -->|no audio| W10
    AE --> FL --> RC -->|3 failures| GU
```

## 3. Where errors are logged vs swallowed

| Layer                    | Logged                                                                                                                                                                              | Swallowed                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Realtime provider events | —                                                                                                                                                                                   | `error`, failed `response.done`, `transcription.failed` (`duplex-line.ts:1326-1328`, `1400-1412`) |
| Browser relays           | —                                                                                                                                                                                   | every server action error → `null` (`duplex-actions.ts`)                                          |
| Broker                   | ask_q failure warn (`broker.ts:569-572`), transcript write warn (`608-613`), usage record warn (`1041`), cap info, rejoin mint warn (`1111-1114`), inability/stall warn (`871-882`) | heard/tool route ZodError surfaces only as a Fastify 500 log (not inspected)                      |
| Gateway mint             | `duplex voice secret not minted` + failureClass (`main.ts:5466-5467`)                                                                                                               | provider status code (only in failureClass mapping)                                               |
| Standard think           | `voice think refused` with fingerprints (`think.ts:191-199`), `voice think turn failed` (`380-383`)                                                                                 | —                                                                                                 |
| Speak relay              | refused / upstream status / stream ended early (`routes.ts:409-532`)                                                                                                                | premature close (by design)                                                                       |
| Browser standard line    | console warn/info only (`deepgram-session.ts:302-314`, `341`, `379`, `396`, `508-513`, `597`)                                                                                       | nothing sent to a server                                                                          |

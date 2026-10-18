# Voice state machine (investigator C)

Public states: `IDLE CONNECTING LISTENING USER_SPEAKING THINKING Q_SPEAKING INTERRUPTED ERROR` (`apps/web/src/features/voice/session.ts:14-33`). Labels: USER_SPEAKING and INTERRUPTED both read "Listening"; ERROR reads "Voice paused".

## 1. Duplex line (`apps/web/src/features/voice/provider/duplex-line.ts`)

```mermaid
stateDiagram-v2
    [*] --> CONNECTING: open() (526)
    CONNECTING --> LISTENING: data channel open (560)
    CONNECTING --> IDLE: connect fail x2 -> fallback CONNECT (554-556, 2223)
    LISTENING --> THINKING: speakFirst (1081)
    LISTENING --> USER_SPEAKING: speech_started, Q silent (1267)
    USER_SPEAKING --> THINKING: speech_stopped (1281)
    THINKING --> LISTENING: transcript empty (1585)
    THINKING --> LISTENING: heard result silent (1650)
    THINKING --> THINKING: routeHeard / relayTool (1424, 1616)
    THINKING --> Q_SPEAKING: output_audio_buffer.started (1352)
    THINKING --> USER_SPEAKING: speech_started while response generating -> immediate barge-in (1266, 1236)
    Q_SPEAKING --> LISTENING: output_audio_buffer.stopped/cleared (1372)
    Q_SPEAKING --> Q_SPEAKING: speech under 450 ms, blip: Q ducked then restored (1199)
    Q_SPEAKING --> USER_SPEAKING: speech of 450 ms or more: barge-in (1185-1237)
    LISTENING --> CONNECTING: rejoin NETWORK/RELAY (710)
    THINKING --> CONNECTING: rejoin (710)
    Q_SPEAKING --> CONNECTING: rejoin (710)
    CONNECTING --> LISTENING: rejoined (758)
    LISTENING --> IDLE: idle 30 s -> onEnded IDLE (1153-1175)
    LISTENING --> IDLE: close() / fallback (1004, 2173)
    IDLE --> [*]

    note right of THINKING
      NO watchdog on duplex. Stuck here when:
      - routed result dropped after a rejoin (1654-1658)
      - seq/generation guard drops the answer (1638)
      - response cancelled/failed/refused (error events ignored)
      - long ask_q (no deadline)
    end note
```

Hidden sub-state that matters: `#routeTurns`, `#pendingTurn` (waiting for transcripts), `#toolsInFlight`, `#turnSeq`, `#generation`, `#transport`, `#rejoining`, `#speakingSilenced`, `#dropNextCommit`, `#heldAnswer`. Guards:

| Guard         | Bumped by                | Checked by                                                                      |
| ------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `#generation` | barge-in only (1216)     | relayTool (1528-1533), routeHeard (1638), narration (1815), bridge timer (1444) |
| `#turnSeq`    | every routed turn (1611) | routeHeard (1638, 1679) — **not** relayTool                                     |
| `#transport`  | every new peer (596)     | relayTool (1508), routeHeard (1654)                                             |

## 2. Standard line (`apps/web/src/features/voice/provider/deepgram-session.ts`)

```mermaid
stateDiagram-v2
    [*] --> CONNECTING: start (258)
    CONNECTING --> LISTENING: settings-applied (383-391)
    CONNECTING --> ERROR: settings not applied in 10 s (376-381)
    LISTENING --> USER_SPEAKING: user-started-speaking, nothing playing (486-489)
    LISTENING --> THINKING: conversation-text(user) (440-442)
    USER_SPEAKING --> THINKING: conversation-text(user)
    THINKING --> THINKING: agent-thinking (515-522)
    THINKING --> LISTENING: 14 s watchdog (358-368)
    THINKING --> Q_SPEAKING: agent-started-speaking (523-529)
    Q_SPEAKING --> INTERRUPTED: user-started-speaking while playing (490-498)
    INTERRUPTED --> THINKING: [continue] repair after 4.4 s quiet (454-474)
    INTERRUPTED --> THINKING: conversation-text(user)
    Q_SPEAKING --> LISTENING: agent-audio-done + remaining playback (538-556)
    Q_SPEAKING --> LISTENING: no audio within 10 s -> "I can't speak out loud" (335-349)
    LISTENING --> ERROR: error / disconnected -> onEnded dropped (570-617)
    ERROR --> CONNECTING: reconnect 1.2 s / 3 s / 8 s (use-voice-interview.ts:112, 256-286)
    ERROR --> IDLE: out of tries -> GAVE_UP notice (257-264)
    LISTENING --> IDLE: end() (711-726)
```

## 3. Line ownership (one microphone per tab)

```mermaid
stateDiagram-v2
    [*] --> NoHolder
    NoHolder --> Held: openVoiceLine(next) (voice-line.ts:59)
    Held --> Releasing: another surface opens / reopen
    Releasing --> Held: previous.release awaited, new holder set
    Held --> NoHolder: endVoiceLine / dropVoiceLine
```

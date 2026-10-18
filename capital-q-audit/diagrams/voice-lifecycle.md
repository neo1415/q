# Voice lifecycle (investigator C)

Source of truth: `capital-q-audit/04-VOICE-SYSTEM.md`. Line refs at HEAD 520bd123.

## 1. Session issue and transport choice

```mermaid
sequenceDiagram
    autonumber
    participant UI as Web surface (useVoiceInterview.talk)
    participant SA as Next server action startVoiceSessionAction
    participant API as q-api POST /v1/q/voice/sessions (routes.ts:551)
    participant BR as DuplexBroker.open (broker.ts:643)
    participant GW as Realtime gateway (realtime/index.ts:257)
    participant OAI as OpenAI client_secrets
    UI->>SA: talk({thread, resume?, duplex?}) (use-voice-interview.ts:445)
    SA->>API: create session (screen, locale, voice)
    API->>API: compose opener (routes.ts:600-733), releaseFor(user) (809)
    API->>API: Deepgram token + agent settings (812-833)
    alt CQ_VOICE_REALTIME on and not rehearsal
        API->>BR: open(binding, firstMessage, locale, vocabulary) (875)
        BR->>BR: daily cap, firewall plan, tool offer, listening level
        BR->>GW: mint(instructions, tools [ask_q,set_listening,decide_card], routeTurns, transcription)
        GW->>OAI: POST /v1/realtime/client_secrets (openai.ts:82)
        OAI-->>GW: ephemeral secret
        GW-->>BR: MINTED
        BR-->>API: DUPLEX credential (routeTurns, idleMs 30s, maxSessionMs 10min)
    else any failure
        BR-->>API: FALLBACK(reason)
    end
    API-->>UI: credential {provider: deepgram, deepgram settings, duplex?}
    UI->>UI: useVoiceSession.start (use-voice-session.ts:50-65)
    alt credential.duplex present
        UI->>UI: duplex.start() -> DuplexLine.open()
        Note over UI: false => standard line on SAME credential, silently
    else
        UI->>UI: deepgram.start()
    end
```

## 2. Duplex line, one routed turn (default: routeTurns on)

```mermaid
sequenceDiagram
    autonumber
    actor P as Person
    participant DL as DuplexLine (browser, duplex-line.ts)
    participant OAI as OpenAI Realtime (WebRTC + oai-events)
    participant SA as Next server actions (ONE AT A TIME per client)
    participant BR as DuplexBroker (in-process Map)
    participant VT as timedVoiceTurns -> voice turn handler (turn.ts:1857)
    participant RUN as Q run (q-runtime / q-specialists answer.ts)
    participant NP as /api/q-voice-narration (route, long poll)
    DL->>OAI: getUserMedia(echoCancellation, noiseSuppression) + SDP offer (283, 628-642)
    OAI-->>DL: SDP answer, data channel open
    DL->>OAI: response.create "Say exactly this ... word for word" (speakFirst 1070-1083)
    OAI-->>P: opener audio (marin/cedar)
    P->>OAI: speech
    OAI-->>DL: input_audio_buffer.speech_started (1259)
    Note over DL: Q audible? -> duck 0.3, confirm 450 ms (1185)<br/>response generating? -> barge-in NOW (1266)
    OAI-->>DL: speech_stopped -> state THINKING (1271-1282)
    OAI-->>DL: input_audio_buffer.committed (item) (1283)
    DL->>DL: turnFinished: wait max  2.5 s for transcripts (1541-1558)
    OAI-->>DL: input_audio_transcription.completed (gpt-4o-transcribe) (1306)
    alt transcript empty
        DL->>DL: LISTENING, nothing said (1582-1587)
    else transcript timed out
        DL->>OAI: response.create tool_choice=ask_q (forceAskQ 1594)
        Note over DL,OAI: model writes the request -> tool path (diagram 3)
    else words
        DL->>SA: heard {transcript, cardInFocus} (routeHeard 1604-1629)
        DL->>NP: narration long poll after 600 ms (1811-1864)
        SA->>BR: POST /duplex/heard (duplex/routes.ts:92)
        BR->>BR: routeDuplexTurn (routing.ts:167): guided/awaitingApproval->ASK_Q, cardInFocus and max 12 words->MODEL, smalltalk->SMALLTALK, else ASK_Q
        alt ASK_Q
            BR->>VT: turn(binding, settledTurn(history+asked), collectingSpeaker) (broker.ts:528)
            VT->>RUN: createRun(ANSWER, VOICE) (turn.ts:1017)
            RUN-->>VT: stage events / deltas / completed / SILENT
            VT-->>NP: silence-ladder beats via narrate (narration.ts:131)
            NP-->>DL: beats -> out-of-band "Say exactly this" (1905)
            VT-->>BR: collected text (facts NOT forwarded by timedSpeaker)
            BR-->>SA: {route ASK_Q, callId, output {ok, say}, silent?}
        else SMALLTALK or MODEL
            BR-->>SA: {route}
        end
        SA-->>DL: result (no timeout, queue blocks turn poll meanwhile)
        alt seq or generation changed
            DL->>DL: drop result (1638)
        else route != ASK_Q
            DL->>OAI: response.create (auto tools) -> model answers WITHOUT Q (1643-1646)
        else silent
            DL->>DL: LISTENING, nothing said (1647-1652)
        else transport changed and not rejoining
            DL->>DL: DROPPED, state stays THINKING (1654-1658)
        else
            DL->>OAI: function_call + function_call_output items (1661-1677)
            DL->>OAI: response.create tool_choice=none (after bridge hold) (1678-1685)
            OAI-->>P: Q's answer, voiced by realtime model
            OAI-->>DL: output_audio_transcript.done -> said relay (1376-1396)
            DL->>SA: said -> voice_line_turns (Q row)
        end
    end
```

## 3. Duplex line, model-initiated tool call

```mermaid
sequenceDiagram
    autonumber
    participant OAI as OpenAI Realtime
    participant DL as DuplexLine.relayTool (1416)
    participant PG as Page card decider (line-cards.ts)
    participant SA as server action relayDuplexToolAction
    participant RT as POST /duplex/tool (duplex/routes.ts:62)
    participant BR as broker.tool (broker.ts:918)
    OAI-->>DL: response.function_call_arguments.done (name, args)
    alt name == decide_card and a decider is registered
        DL->>PG: decideCardByVoice(args, own transcript) (1461-1469)
        PG-->>DL: outcome JSON (or "pass their words to ask_q")
    else
        DL->>SA: tool {callId, name, arguments}
        SA->>RT: POST
        RT->>BR: tool(): ask_q -> askQ(model's words) (944)
        BR-->>RT: {output, approvalPending, silent?}
        RT->>RT: QVoiceDuplexToolResultSchema.parse (STRICT) (86)
        alt silent present
            RT-->>SA: 500 (unrecognized key "silent")
            SA-->>DL: null
            DL->>DL: output = "That request did not get through..." (1496-1502)
        else
            RT-->>SA: 200 result
            SA-->>DL: result
        end
    end
    DL->>OAI: function_call_output
    alt generation unchanged (only barge-in bumps it, a newer TURN does not)
        DL->>OAI: response.create (auto) (1529-1533)
    end
```

## 4. Standard line (Deepgram agent + Q think + ElevenLabs speak relay)

```mermaid
sequenceDiagram
    autonumber
    actor P as Person
    participant DS as deepgram-session (browser)
    participant DG as Deepgram Voice Agent (wss agent/converse)
    participant TH as q-api /v1/q/voice/think/chat/completions (think.ts)
    participant VT as voice turn handler (turn.ts)
    participant RUN as Q run
    participant SP as q-api /v1/q/voice/speak (routes.ts:398)
    participant EL as ElevenLabs (v3 -> turbo -> Aura-2)
    DS->>DG: Settings (flux-general-en, eot 0.85/4s, think+speak endpoints, PCM16 16k in / 24k out)
    DG-->>DS: settings-applied -> LISTENING, greeting
    P->>DS: speech (AgentMicrophone 16 kHz)
    DS->>DG: PCM frames
    DG-->>DS: conversation-text(user) -> THINKING + 14 s watchdog (398-447)
    DG->>TH: chat.completions (messages, bearer = think token)
    TH->>VT: turn(binding, transcript, signal, speaker) (376)
    VT->>RUN: createRun / stream events
    VT-->>TH: silence-ladder beats then answer sentences (speakable)
    TH-->>DG: SSE deltas per sentence, keep-alive 5 s, deadline 20 s
    alt nothing to say (SILENT, NOTHING)
        TH-->>DG: stop with no content
        Note over DS: "Thinking" up to 14 s, then LISTENING
    else
        DG->>SP: text per sentence (bearer = think token)
        SP->>EL: stream TTS (voice from binding)
        EL-->>SP: audio
        SP-->>DG: audio bytes
        DG-->>DS: agent-started-speaking, audio (PCM 24k) -> PcmPlayer
        DS-->>P: playback (prebuffer 180 ms)
    end
    P->>DG: talks over Q
    DG-->>DS: user-started-speaking -> player.interrupt, discard 700 ms (475-499)
    DG--xTH: drops request -> turn signal aborts -> answer held for "go on"
```

# Voice resilience on bad networks (I1)

Research agent M1, 2026-10-06. Feeds I1: OpenAI realtime voice must survive bad networks (the Dubai demo fell back to the slow, stuttering standard voice), stay fast and keep the same voice.

## 1. Summary for builders

- **The Dubai failure is very likely the network, not the code.** The UAE regulator restricts unlicensed VoIP; ISPs use deep packet inspection to identify and block WebRTC traffic of unlicensed calling services, on local networks, hotel Wi-Fi and airports ([Doft VPN](https://vpn.doft.com/blog/uae-voip-blocks-and-privacy-risks-using-the-internet-in-the-uae/), [Nomad eSIM](https://www.getnomad.app/blog/can-you-make-whatsapp-calls-in-dubai), [Gulf News](https://gulfnews.com/technology/usage-of-voip-technology-grows-in-dubai-despite-ban-1.304919)). Plus distance: OpenAI's realtime WebRTC endpoints are **US Azure regions (Chicago, Virginia, Austin)** ([webrtcHacks](https://webrtchacks.com/how-openai-does-webrtc-in-the-new-gpt-realtime/)), so Dubai → US adds roughly 200-250 ms RTT before any loss. Confirm with today's session stats (the line-health module already samples loss, jitter, RTT).
- OpenAI's WebRTC offers **host candidates only (no STUN/TURN)**, on **UDP 3478 and TCP 443**, Opus with **in-band FEC**, no DTX, no RED ([webrtcHacks](https://webrtchacks.com/how-openai-does-webrtc-in-the-new-gpt-realtime/)). Our client creates `new RTCPeerConnection()` with no ICE servers (`apps/web/src/features/voice/provider/duplex-line.ts:163`); that is fine for OpenAI's host candidates, but there is no relay path we control.
- **Fallback that keeps the same voice**: the same realtime model and voice (e.g. `marin` / `cedar`) are available over **WebSocket** (TLS on 443, looks like HTTPS, survives most DPI and UDP blocks) ([OpenAI WebSocket guide](https://developers.openai.com/api/docs/guides/realtime-websocket/index.html), [OpenAI WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc.md)). Use it through **our own relay** in a nearby region (keeps the API key server-side, lets us add jitter buffering and PCM pacing). The current fallback switches to a different "standard" pipeline and a different voice: that is what the founder heard.
- Latency target: voice-to-voice p50 ≤ 800 ms, p95 ≤ 1,200 ms. WebRTC typically gives ~220-400 ms time-to-first-audio vs 600 ms+ over WebSocket round-trips ([eesel](https://www.eesel.ai/blog/openai-webrtc)); a full pipeline budget of 500-800 ms is the industry bar ([channel.tel](https://www.channel.tel/blog/voice-ai-pipeline-stt-tts-latency-budget), [Pipecat docs](https://docs.pipecat.ai/guides/learn/overview)).

## 2. Ladder of transports (recommended)

Try in order, fast. Each rung keeps **the same model and the same voice**; only the transport changes.

| Rung | Path | When it works | Cost / risk |
|---|---|---|---|
| 1 | Browser ⇄ OpenAI WebRTC (UDP 3478) | Normal networks | Lowest latency; current path |
| 2 | Browser ⇄ OpenAI WebRTC via ICE-TCP 443 | UDP blocked, TCP open | Head-of-line blocking under loss; still FEC; usually automatic if the TCP candidate is offered |
| 3 | Browser ⇄ **our relay** over WebRTC with **our TURN (UDP 3478 → TURN/TLS 443)**; relay ⇄ OpenAI realtime via WebSocket server-to-server | DPI blocks WebRTC to OpenAI IPs, or symmetric NAT | Needs a media relay service (LiveKit Cloud / LiveKit Agents with OpenAI plugin, Daily/Pipecat, or self-hosted); TURN/TLS on 443 mimics HTTPS ([LiveKit firewall tips](https://livekit.com/field-guides/guide/firewall-tips), [LiveKit community](https://community.livekit.io/t/wifi-cellular-mid-call-what-livekit-already-handles-and-the-two-things-that-still-bite/1731)) |
| 4 | Browser ⇄ **our relay** over **WebSocket/TLS 443** (PCM16 or Opus frames) ⇄ OpenAI realtime WebSocket | Everything except HTTPS blocked; WebRTC DPI'd | Higher latency (TCP), but same voice and same brain; client jitter buffer needed |
| 5 | Same realtime model, **text in, same voice audio out** (push-to-talk: record locally, upload clip, stream response audio) | Very poor uplink | Half-duplex; no back-channelling; still the same voice |
| 6 | Text chat with Q | Offline-ish | Always available |

Notes:
- DPI in the UAE targets VoIP signatures; WebRTC media to a relay over TURN/TLS 443 (rung 3) or a WebSocket on 443 (rung 4) is generally indistinguishable from HTTPS. Do not market this as circumvention; it is standard enterprise-firewall traversal. Check legal stance for UAE use with counsel if Capital Q targets UAE users at scale; the licensed-operator rule targets consumer calling apps, not an AI assistant, but this is a judgement for counsel, not engineering.
- **Model Gateway** (CLAUDE.md): the relay is the gateway's realtime adapter (task class "realtime voice"); feature code never calls OpenAI directly. Rung 3/4 also give us server-side Context Firewall enforcement of tools and transcripts.
- Region: put the relay close to users (Europe-West for Africa and the Gulf: Frankfurt / London / Amsterdam ~100-130 ms from Dubai and Lagos; Johannesburg for southern Africa). The relay ⇄ OpenAI hop then runs on a datacentre link. Azure OpenAI realtime is offered in East US 2 and Sweden Central ([Azure docs mirror](https://dotnet.territoriali.olinfo.it/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc)), which could cut the last hop for Europe/Africa; adding Azure is a provider change and needs an ADR.

## 3. Choosing a rung fast (no stutter at start)

- **Race, don't wait**: start rung 1 and, in parallel after 1.5 s without `connected`, start rung 4's WebSocket. Use whichever is healthy first; tear down the other. Today the line waits for failure then switches pipelines.
- **Remember per network**: store the last working rung keyed by a coarse network fingerprint (connection type + public IP /24 hashed, or just "last session") so the next session in the same hotel starts on rung 3/4 immediately.
- **Pre-warm**: fetch the ephemeral client secret and open the relay socket when the Q dock opens or the wake word fires, not when the user starts speaking. Ephemeral keys are valid for connection start for about 60 s and sessions last up to 30 min ([Simon Willison](https://simonwillison.net/2024/Dec/17/openai-webrtc)); refresh before expiry and reconnect transparently.
- **Upgrade mid-session**: if on rung 4 and network improves, do not switch mid-utterance; switch only at a turn boundary, keeping conversation state server-side (the relay holds the realtime session, so the browser leg can change without losing context).

## 4. Tuning on a working WebRTC line

| Knob | Setting | Why |
|---|---|---|
| Opus FEC | On (OpenAI already offers it); from our relay set `useinbandfec=1` and packet-loss hint ~10% when line is weak | Recovers isolated losses; costs ~20-30% bitrate; weak against burst loss of 3+ packets ([omr.it.com](https://omr.it.com/blog/packet-loss-concealment-webrtc-audio-8-percent-drop/)) |
| RED (RFC 2198 redundancy) | On, from our relay (Chrome supports audio RED) | Survives burst loss better than FEC alone; doubles audio bitrate (~64 kbps) which is fine for voice ([omr.it.com FEC vs RED](https://omr.it.com/blog/packet-loss-concealment-webrtc-fec-vs-red/)) |
| DTX | On for the uplink on metered mobile | Saves bandwidth in silence; slight risk of clipped word onsets with server VAD; test |
| Bitrate | 24-32 kbps mono speech; ptime 20 ms (40 ms on very bad links reduces packet overhead) | Speech intelligibility saturates around here |
| Jitter buffer | Browser default (adaptive NetEQ); on rung 4 implement a 60-120 ms adaptive playout buffer | Smooths arrival; the existing `pcm-schedule.ts` is the place |
| Echo cancellation | `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true` | Prevents Q hearing itself (the "it interrupts itself" bug) |
| Turn detection | OpenAI `semantic_vad`, eagerness `auto`/`low` on bad links ([OpenAI VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad/index.html)) | Fewer false barge-ins when audio is choppy |
| ICE restart | On `disconnected` > grace (2.5 s now), call `restartIce()` before tearing down | LiveKit resumes most network switches without a full reconnect ([LiveKit community](https://community.livekit.io/t/wifi-cellular-mid-call-what-livekit-already-handles-and-the-two-things-that-still-bite/1731)) |
| Health thresholds | current: loss 12%, jitter 120 ms, RTT 900 ms, 2 bad samples | Reasonable; add a "degraded" state at loss > 5% that turns on RED/FEC hint and lowers eagerness before declaring weak |

## 5. Latency budget (voice-to-voice, measured at the user)

| Segment | Budget (good) | Budget (bad network, rung 3-4) |
|---|---|---|
| Capture + client processing (worklet, encoding) | 20-40 ms | 20-40 ms |
| Uplink to model (one-way) | 50-120 ms | 100-250 ms |
| End-of-turn detection | 200-500 ms (semantic VAD) | 300-600 ms |
| Model time to first audio | 250-450 ms | 250-450 ms |
| Downlink first audio + jitter buffer | 60-150 ms | 150-300 ms |
| **Total to first sound** | **~600-1,000 ms** | **~900-1,600 ms** |

Mask the remainder: back-channel / acknowledgement (the existing `backchannel.ts`), the "thinking" earcon (sound-design.md), presence animation. A short acknowledgement within ~300 ms makes 1.2 s feel responsive.

Instrument per turn: `t_speech_end`, `t_first_audio`, rung, RTT, loss, jitter; log as ANALYTICS (no audio, no transcripts in analytics). Dashboard p50/p95 per country.

## 6. Diagnosing today's sessions (checklist for the I1 builder)

1. Pull the line-health samples and fallback events for the Dubai sessions: was the line ever `connected`? If ICE never connected → blocked (rung 3/4 needed). If connected then WEAK → loss/jitter (FEC/RED, relay region).
2. Check `getStats()` candidate-pair: was it UDP or TCP? Local candidate type?
3. Check whether the fallback reason was `connectionState=failed` or a timeout on the ephemeral key fetch (slow HTTPS to our API from Dubai is a separate latency path: L1).
4. Check whether more than one line was open (the `voice-line.ts` single-owner fix from 5 Oct).
5. Reproduce locally with Chrome's network throttling plus `tc netem` (loss 5-15%, jitter 50-100 ms, RTT 300 ms) and with UDP blocked by firewall rule; assert the ladder reaches a working rung within 3 s and the voice id stays the same.

## 7. Gaps and recommendations

1. **Same voice everywhere**: also use the realtime voice for the cached greeting and earcon-adjacent phrases (wake-word.md), and for any TTS fallback choose the same voice name if the TTS model supports it (verify `marin`/`cedar` availability in the TTS endpoint before relying on it).
2. **Never silently switch voice.** If the only option is a different pipeline, say so: "Weak connection. Switching to a lighter mode." Better honest than uncanny.
3. **Network indicator** in the voice UI: three states (Good · Weak · Reconnecting) with words, not just colour.
4. **Uplink first**: on bad uplinks, the user's speech is what breaks; consider sending audio at 16 kHz mono Opus 16-24 kbps with FEC/RED.
5. **Mobile data in Africa**: data cost matters; realtime audio uses ~0.25-0.5 MB per minute at 32-64 kbps; show nothing, but avoid video and keep DTX on mobile.
6. **Server-side session state** (relay holds the session) enables reconnect without losing context, and lets text and voice share one conversation.
7. **Budget**: a relay (LiveKit Cloud or self-hosted on Render) is new infrastructure; start with rung 4 (simple WebSocket relay in the existing api app or q-api, behind the Model Gateway) because it fixes DPI and UDP blocks with the least new infrastructure; add rung 3 later if measurements justify it.
8. **Founder's credits**: testing realtime fallbacks makes live OpenAI calls; keep tests on recorded fixtures and simulated networks; any live test needs lead approval and a cost report (CLAUDE.md).

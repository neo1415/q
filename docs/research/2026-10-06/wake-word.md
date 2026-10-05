# Wake word research (D1, D2)

Research agent M1, 2026-10-06. Feeds "Hey Q / Hello Q / Hi Q / OK Q" (D1) and the on-device engine, toggle, permission and battery care (D2).

## 1. Summary and recommendation

**Recommend: custom openWakeWord-format ONNX models trained with our own phrases, run in the browser with onnxruntime-web (WASM) behind a voice-activity gate, inside an AudioWorklet.** Nothing leaves the device before the wake word. Train with the livekit-wakeword pipeline (Apache 2.0, openWakeWord-compatible ONNX, synthetic TTS data, reported far fewer false positives than openWakeWord's default head) ([LiveKit blog](https://livekit.com/blog/livekit-wakeword), [GitHub](https://github.com/livekit/livekit-wakeword)).

Why not the others:
- **Picovoice Porcupine Web**: best-in-class and trivially easy (type the phrase, get a model in seconds), but the Free tier was discontinued on **30 June 2026** (keys disabled; "no non-commercial tier planned"), and the Foundation plan is **$6,000/year for 100 monthly active users**, only for startups under 5 years and ≤ 20 staff ([Home Assistant community](https://community.home-assistant.io/t/porcupine-free-tier-shutdown-alternatives-for-home-assistant-voice-users/1012382), [Picovoice free tier blog](https://picovoice.ai/blog/introducing-picovoices-free-tier), [FitGap](https://us.fitgap.com/products/picovoice-voice-ai)). An MAU-priced key would cap a growing product and puts a vendor key in the client. Keep as plan B if our own models fail quality.
- **openWakeWord pretrained models**: code is Apache 2.0 but the **pretrained models are CC BY-NC-SA 4.0 (non-commercial)** ([PyPI](https://pypi.org/project/openwakeword/0.4.0/), [Hugging Face README](https://huggingface.co/davidscripka/openwakeword/raw/main/README.md)). There is no "Hey Q" model anyway; we must train our own, and we must check the licences of everything used in training (see 4).
- **Web Speech API**: until recently Chrome sent audio to Google servers; on-device recognition is now being added (websites can require local processing and prompt a language-pack install) on Windows, Mac, Linux first ([W3C TAG review #1038](https://tag-github-bot.w3.org/gh/w3ctag/design-reviews/1038), [Chromium intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/VNOok2dbmHM/m/TQpe9shjCgAJ)). Not on iOS Safari, not on Android Chrome yet, continuous recognition times out, and transcribing everything to spot "Hey Q" is far heavier than a keyword model. Not suitable as the always-on detector. Possibly a second-stage verifier on desktop.
- **TensorFlow.js speech-commands**: classifies 1-second clips over ~18-20 fixed words with transfer learning from user recordings ([TF.js codelab](https://codelabs.developers.google.com/codelabs/tensorflowjs-audio-codelab)). Fine for demos, weak for multi-word phrases and speaker-independent use; large TF.js runtime. Not recommended.

## 2. Architecture in the browser

```
mic (getUserMedia, echoCancellation, noiseSuppression, autoGainControl)
  → AudioWorklet: downmix + resample to 16 kHz, 80 ms frames (1280 samples)
  → VAD gate (Silero VAD ONNX or a light energy+zero-crossing gate)
      no speech → skip (saves CPU / battery)
      speech    → melspectrogram ONNX → embedding ONNX (shared) → 4 tiny phrase heads (Hey Q, Hello Q, Hi Q, OK Q)
  → score smoothing: k-of-n frames above threshold, refractory 2 s
  → fire "wake" (local event) → open Q, play "listening on" earcon, start the realtime session
```

- Run inference in a **Web Worker** (onnxruntime-web WASM, SIMD + threads where cross-origin isolated); the worklet only moves audio. Never block the main thread (INP target ≤ 200 ms).
- Model sizes: melspectrogram + embedding models are shared (~1-3 MB total in openWakeWord's format, community browser ports report ~3 MB) ([stimulus-speak-then README](https://cdn.jsdelivr.net/npm/stimulus-speak-then@0.1.7/README.md)); each phrase head is tens to hundreds of KB. Lazy-load only when the user turns the toggle on; cache with a service worker.
- One embedding pass feeds all four heads, so four phrases cost little more than one. Alternatively train a single head on all four phrases as one positive class (simpler, slightly worse per-phrase accuracy). Start with one head, measure.
- **Pre-roll buffer**: keep the last ~1.5 s of audio in a ring buffer **in memory only**; on wake, the user's follow-on words ("Hey Q, show me the top three") are not lost. Drop the buffer otherwise; never upload before wake (D2 privacy).
- When Q is already in a live voice session, pause the detector (the realtime session has its own turn detection) to avoid double triggers and save CPU.

## 3. Latency, battery and platform constraints

- **Detection latency**: frame-based models decide within a few frames after the phrase ends; budget ≤ 300 ms from end of "Q" to UI response, then play the greeting. To make it feel instant (D1), show the Q presence and play the earcon **immediately on wake**, before the realtime connection is ready; play a locally cached greeting audio ("Hi, what can I do?") in Q's voice, generated once with the same TTS voice, so the greeting needs no network round trip. Then hand over to the live session.
- **CPU / battery**: always-on WASM inference costs a few percent of one core on laptops; on phones it adds noticeable drain. Mitigations: VAD gate (most of the time nothing runs past the VAD), stop entirely when the tab is hidden (Page Visibility API), stop on low battery where the Battery Status API exists (Chromium only), auto-off after N minutes of no use (setting: 15 min default on mobile), lower frame rate when idle.
- **iOS Safari**: microphone capture works only while the page is visible; installed web apps (home-screen PWAs) lose the mic when backgrounded or screen-locked; tracks end and must be re-requested on `visibilitychange` ([WebKit bug 204681](https://bugs.webkit.org/show_bug.cgi?id=204681), [WebKit bug 226620](https://bugs.webkit.org/show_bug.cgi?id=226620), [Apple forum](https://developer.apple.com/forums/thread/708280)). So: **wake word only while Capital Q is open and on screen**; re-arm on return. The orange/green mic indicator will always show while listening, so say so in the UI. Safari also requires a user gesture to start audio contexts: arm the detector from the toggle tap.
- **Android Chrome**: similar; background tabs are throttled; treat as foreground-only.
- **Desktop**: works while the tab is open; consider only when the window is focused by default, with an option "Listen when Capital Q is in the background".
- **Echo**: Q's own voice saying "OK" or "hi" could self-trigger; disable the detector while Q speaks and rely on echo cancellation.

## 4. Training "Hey Q / Hello Q / Hi Q / OK Q"

Pipeline (livekit-wakeword / openWakeWord style):
1. **Positives**: synthesise thousands of utterances per phrase with multiple TTS voices, accents, speeds and pitches. Must include **African English accents (Nigerian, Kenyan, South African, Ghanaian)**, British and American, male and female, because the founder base is African; plus real recordings from the team (tens of people × a few repetitions) for validation.
2. **Hard negatives** (the critical part for these phrases): "Q" is one short syllable and sounds like *cue, queue, you, view, few, Hugh, IQ, PQ*; "OK Q" ≈ "okay cool", "OK you"; "Hi Q" ≈ "hi you", "high cue"; "Hey Q" ≈ "hey you" (very common!). Generate adversarial negatives for all of these.
3. **Background**: speech, music, TV, street noise, office noise, and **Capital Q's own TTS voice** (to stop self-trigger).
4. **Augment**: reverb, noise at several SNRs, gain, phone and laptop mic responses.
5. **Train** small heads on frozen embeddings; export ONNX; calibrate thresholds per phrase.
6. **Evaluate**: false accepts per hour on long negative audio (target ≤ 0.5 / hour, aim 0.1), false rejects on held-out real recordings (target ≤ 10%, i.e. recall ≥ 90%), by accent group. LiveKit reports 0.08 false positives/hour and 86% recall for its pipeline vs 8.5/hour and 69% for openWakeWord on its benchmark ([LiveKit blog](https://livekit.com/blog/livekit-wakeword)); expect worse for a 2-syllable phrase.

Licensing checklist before shipping a trained model commercially: TTS voices used for synthesis (Piper voices have per-voice licences; some datasets behind them are non-commercial), negative datasets, and the frozen embedding / melspectrogram models' licences (openWakeWord's own pretrained heads are CC BY-NC-SA; confirm the shared feature models separately). Prefer voices and datasets with CC0 / CC BY / Apache / MIT licences, or generate positives with a commercial TTS we already pay for (OpenAI or ElevenLabs output terms permit this; founder's credits, needs approval).

**Phrase advice**: very short wake phrases have higher false-accept rates. "Hello Q" (3 syllables) will be the most reliable; "Hey Q" is the most natural but collides with "hey you". Ship all four, measure per-phrase false accepts, and be ready to drop the worst (likely "Hi Q" or "OK Q"). The founder accepted 3-4 phrases (D1).

## 5. UX (D2)

- **Toggle** in Settings → Voice and in the Q dock long-press menu: "Listen for 'Hey Q'". Default **off**. First enable explains in one sentence: "Q listens on this device for 'Hey Q'. Nothing is sent until you say it." Then the browser mic prompt.
- **Visible state** whenever the detector is armed: small ear / mic glyph on the Q dock with tooltip "Listening for Hey Q", plus the browser's own indicator. Tapping it pauses.
- **Per device**: stored locally (localStorage, wrapped in try/catch), not synced; a laptop and a phone have different contexts.
- **Battery care**: "Turn off after 15 minutes without use" (default on for mobile), "Only when plugged in" (where detectable).
- **False wake**: if the user says nothing within ~4 s after waking, close quietly; one tap "That wasn't me" logs a local false-accept counter (never audio) for tuning the threshold on that device.
- **Accessibility**: wake word is never the only way; the Q button and a keyboard shortcut always work.
- **Greeting** (D1): short and varied by time of day; plays only after a wake word, not after a tap (tap users want to talk immediately).

## 6. Gaps and recommendations

1. **No phrase lists except wake words** (J7) — this is the explicit exception; keep the four phrases in one versioned config with their thresholds.
2. **Threshold per device class**: phones and laptops need different thresholds; ship calibrated presets, allow a sensitivity slider (Low / Normal / High).
3. **Privacy statement** in Settings and the privacy policy: on-device detection, no audio stored, no audio sent before wake; the ring buffer stays in memory.
4. **Kill switch**: remote config flag to disable the wake word globally if false-wake rates spike.
5. **Telemetry without audio**: count wakes, false-wake taps and time-armed per session (ANALYTICS), never audio or transcripts.
6. **Fallback**: if WASM SIMD or AudioWorklet is unavailable, hide the toggle rather than shipping a slow detector.
7. **Testing**: a Playwright test can inject audio via a fake media stream (`--use-file-for-fake-audio-capture` in Chromium) to assert wake → Q opens; deterministic Vitest on the smoothing logic.
8. **Plan B**: if our models miss the bar after one training iteration, Porcupine Web on the Foundation plan is the fastest fallback; budget $6,000/year and treat the access key as a public-ish client credential (rotate, domain-restrict).

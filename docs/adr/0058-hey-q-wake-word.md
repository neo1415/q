# ADR 0058: "Hey Q" with a local gate and the browser's speech recogniser

Status: Accepted (founder brief 2026-10-06, items D1, D2)
Amends: research note 2026-10-06 `wake-word.md` §1 (recommended detector); D2's "nothing streamed before the wake word" holds only for the gate, see Consequences.

## Context

D1 asks for "Hey Q", "Hello Q", "Hi Q" and "OK Q" to open Q at once, with a greeting. The research recommends our own openWakeWord-format model trained with the Apache-2.0 livekit-wakeword pipeline, run with onnxruntime-web. Picovoice costs $6,000 a year; openWakeWord's pretrained heads are non-commercial.

Training was not feasible in this session: the build VM is shared by four builders (4 vCPU, no GPU), torch, a licensed multi-accent TTS voice set and the negative-audio corpus (tens of GB) are not present, and a model trained only on espeak voices would ship a detector that misses real accents. A model that does not work is worse than an honest fallback.

## Decision

1. Engine in `apps/web/src/features/wake/`: AudioWorklet capture (`public/wake/capture-worklet.js`, 16 kHz, one loudness value per 32 ms, no audio leaves the worklet) → a pure voice-activity gate (`gate.ts`: adaptive noise floor, 3-frame onset, window closes 3.5 s after speech, hard cap 8 s, 1 s rest, at most 6 windows a minute, 3 s cooldown after a wake) → detector.
2. Detector: the browser's speech recogniser (Chrome, Edge, Safari), started only inside a gate window and aborted when it closes. The transcript is fuzzy-matched on words (`phrases.ts`: the four greetings with spellings a recogniser writes, and "Q", "cue", "queue", "kew"); "you", "cool", "view" are deliberately excluded. The transcript is never stored or sent to Capital Q.
3. The engine is a dynamic-import chunk loaded only when the toggle is on. No onnxruntime-web dependency is added until a model exists; a trained model replaces `speech-detector.ts` behind the same start/stop calls.
4. On a wake: the wake earcon plays (unless Q's sounds are Off), the Q panel opens (the Q page already is Q), and the live line starts with "Hi — what can I do?" as Q's first spoken line (`resume`, so no model composes an opening).
5. Settings → Q → "Say 'Hey Q' to start", per device, off by default; the microphone is asked for from the tap. The shell shows "Listening for 'Hey Q'" with Pause whenever the microphone is open. It stops when the tab is hidden, while any voice line is held, and on low battery where the Battery Status API exists.

## Consequences

- Silence and noise below the gate never leave the device. Speech that opens the gate may go to the browser vendor's speech service (Google in Chrome, Apple in Safari) for at most 8 s per window; Settings says so before the toggle is turned on. This is weaker than D2's target and is why the trained model remains the plan.
- Firefox has no recogniser: the toggle is disabled there with a reason. iOS and Android listen only while the page is on screen.
- The first word of a sentence can be lost while the recogniser starts (a few hundred ms); saying the phrase again works. A trained model with a pre-roll buffer removes this.
- Next: train with livekit-wakeword on a machine with a GPU, licensed multi-accent voices (including Nigerian, Kenyan, South African, Ghanaian English) and hard negatives; ship the .onnx under `public/models/` with onnxruntime-web in a Web Worker.
